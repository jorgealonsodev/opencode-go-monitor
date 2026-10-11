import type { ActiveKeyProvider, QuotaFetcher, QuotaSnapshot, QuotaWindow } from '../domain/types';
import { AuthError, CredentialsError, NetworkError, ParseError } from '../domain/errors';
import type { FetchFn } from './types';
import { version } from '../../package.json';

export const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
export const USER_AGENT = `opencode-go-monitor/${version}`;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const UNEXPECTED_RESPONSE_MESSAGE =
  'Unexpected response from OpenCode — the extension may need an update.';

const UNKNOWN_WINDOW: QuotaWindow = { status: 'unknown', usagePercent: 0, resetsInSeconds: 0 };
const MAX_LOGGED_STATUS_LENGTH = 32;

const debug = (msg: string) => {
  if (typeof globalThis.opencodeGoQuotaDebug === 'function') {
    globalThis.opencodeGoQuotaDebug(msg);
  }
};

export interface UsageFetcherOptions {
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

/**
 * Fetches Go quota usage from `GET /zen/go/v1/usage`, authenticated with the
 * active profile's API key (Bearer). The endpoint is undocumented, so parsing
 * is strict and all mapping is isolated here.
 *
 * SECURITY: debug output never contains the key, the profile name, raw
 * headers or the raw body — only key length, field names and computed values.
 */
export class UsageFetcher implements QuotaFetcher {
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

  constructor(
    private readonly keys: ActiveKeyProvider,
    options: UsageFetcherOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetch(): Promise<QuotaSnapshot> {
    const active = await this.keys.getActive();
    if (!active) {
      debug('[UsageFetcher] no active profile');
      throw new CredentialsError();
    }

    debug(`[UsageFetcher] fetch started: profile=${active.id}, key=[${active.key.length} chars]`);

    let response: Response;
    try {
      response = await this.fetchFn(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${active.key}`,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw toRequestError(err);
    }

    debug(`[UsageFetcher] response status: ${response.status}`);

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(active.id, active.name, response.status);
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      debug('[UsageFetcher] unexpected redirect');
      throw new ParseError(UNEXPECTED_RESPONSE_MESSAGE);
    }
    if (!response.ok) {
      const retryAfterSeconds =
        response.status === 429 || response.status === 503
          ? parseRetryAfter(response.headers.get('Retry-After'), Date.now())
          : undefined;
      if (retryAfterSeconds !== undefined) {
        debug(`[UsageFetcher] retry-after: ${retryAfterSeconds}s`);
      }
      throw new NetworkError(`HTTP ${response.status}`, response.status, retryAfterSeconds);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      debug('[UsageFetcher] response body is not valid JSON');
      throw new ParseError(UNEXPECTED_RESPONSE_MESSAGE);
    }

    return toSnapshot(data, active.id, Date.now());
  }

  async isAvailable(): Promise<boolean> {
    return (await this.keys.getActive()) !== null;
  }
}

function toRequestError(err: unknown): Error {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    debug('[UsageFetcher] request timed out');
    return new NetworkError('Request timed out');
  }
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  if (cause instanceof Error && /redirect/i.test(cause.message)) {
    debug('[UsageFetcher] unexpected redirect');
    return new ParseError(UNEXPECTED_RESPONSE_MESSAGE);
  }
  const message = err instanceof Error ? err.message : 'Network request failed';
  debug(`[UsageFetcher] network error: ${message}`);
  return new NetworkError(message);
}

/** Parses `Retry-After` as delta-seconds or an HTTP-date; returns undefined when absent or invalid. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) {
    return undefined;
  }
  return Math.max(0, Math.round((date - now) / 1000));
}

function toSnapshot(data: unknown, profileId: string, now: number): QuotaSnapshot {
  const usage = asRecord(asRecord(data)?.usage);
  if (!usage) {
    debug('[UsageFetcher] usage missing');
    throw new ParseError(UNEXPECTED_RESPONSE_MESSAGE);
  }

  debug(`[UsageFetcher] usage keys: ${Object.keys(usage).join(', ')}`);

  const rolling = toWindow('rolling', usage.rolling, now);
  const weekly = toWindow('weekly', usage.weekly, now);
  const monthly = toWindow('monthly', usage.monthly, now);

  debug(
    `[UsageFetcher] percents: rolling=${rolling.usagePercent} (${rolling.status}), ` +
      `weekly=${weekly.usagePercent} (${weekly.status}), ` +
      `monthly=${monthly.usagePercent} (${monthly.status})`,
  );

  if (rolling.status === 'unknown' && weekly.status === 'unknown' && monthly.status === 'unknown') {
    throw new ParseError(UNEXPECTED_RESPONSE_MESSAGE);
  }

  return { timestamp: now, profileId, rolling, weekly, monthly };
}

function toWindow(name: string, value: unknown, now: number): QuotaWindow {
  const w = asRecord(value);
  if (!w) {
    debug(`[UsageFetcher] ${name}: missing`);
    return { ...UNKNOWN_WINDOW };
  }

  debug(`[UsageFetcher] ${name} keys: ${Object.keys(w).join(', ')}`);

  const resetsAt = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN;
  const resetsInSeconds = Number.isFinite(resetsAt)
    ? Math.max(0, Math.round((resetsAt - now) / 1000))
    : 0;

  if (w.status === 'rate-limited') {
    return { status: 'limit-reached', usagePercent: 100, resetsInSeconds };
  }
  if (w.status !== 'ok') {
    debug(`[UsageFetcher] ${name}: unrecognized status '${String(w.status).slice(0, MAX_LOGGED_STATUS_LENGTH)}'`);
    return { ...UNKNOWN_WINDOW };
  }

  const percent = toNumber(w.percent);
  if (!Number.isFinite(percent)) {
    debug(`[UsageFetcher] ${name}: non-finite percent`);
    return { ...UNKNOWN_WINDOW };
  }
  if (percent < 0 || percent > 100) {
    debug(`[UsageFetcher] ${name}: percent out of range: ${percent}`);
  }

  return { status: 'ok', usagePercent: Math.min(100, Math.max(0, percent)), resetsInSeconds };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }
  return NaN;
}
