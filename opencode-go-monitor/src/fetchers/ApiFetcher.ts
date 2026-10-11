import type { QuotaFetcher, QuotaSnapshot, QuotaWindow } from '../domain/types';
import { CredentialsError, NetworkError, ParseError } from '../domain/errors';
import type { CredentialsStorage } from '../storage/credentials';
import type { FetchFn } from './ScrapingFetcher';

export const GO_STATUS_URL = 'https://opencode.ai/console/api/go/status';

const UNKNOWN_WINDOW: QuotaWindow = { status: 'unknown', usagePercent: 0, resetsInSeconds: 0 };

const debug = (msg: string) => {
  if (typeof globalThis.opencodeGoQuotaDebug === 'function') {
    globalThis.opencodeGoQuotaDebug(msg);
  }
};

/**
 * Fetches quota usage from the OpenCode console JSON API
 * (`GET /console/api/go/status`), authenticated with the `auth` cookie and
 * scoped to a workspace through the `x-org-id` header.
 */
export class ApiFetcher implements QuotaFetcher {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly credentials: CredentialsStorage,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async fetch(): Promise<QuotaSnapshot> {
    debug('[ApiFetcher] === fetch started ===');

    const creds = await this.credentials.getCredentials();
    if (!creds) {
      debug('[ApiFetcher] no credentials found');
      throw new CredentialsError();
    }

    debug(`[ApiFetcher] workspaceId: ${creds.workspaceId}`);
    debug(`[ApiFetcher] authCookie length: ${creds.authCookie.length}`);
    debug(`[ApiFetcher] authCookie (masked): ${this.credentials.maskCookie(creds.authCookie)}`);

    // Cookie header must include the name 'auth='
    const cookieHeader = creds.authCookie.startsWith('auth=')
      ? creds.authCookie
      : `auth=${creds.authCookie}`;

    debug(`[ApiFetcher] URL: ${GO_STATUS_URL}`);

    let response: Response;
    try {
      response = await this.fetchFn(GO_STATUS_URL, {
        headers: {
          Cookie: cookieHeader,
          'x-org-id': creds.workspaceId,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      debug(`[ApiFetcher] network error: ${err instanceof Error ? err.message : String(err)}`);
      throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
    }

    debug(`[ApiFetcher] response status: ${response.status}`);

    if (!response.ok) {
      debug(`[ApiFetcher] HTTP error: ${response.status}`);
      throw new NetworkError(`HTTP ${response.status}`, response.status);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      debug('[ApiFetcher] response body is not valid JSON');
      throw new ParseError('Status response is not valid JSON');
    }

    // SECURITY: Only log key names and computed values, never the full response
    if (data && typeof data === 'object') {
      debug(`[ApiFetcher] response data keys: ${Object.keys(data).join(', ')}`);
    }

    return this.normalizeResponse(data);
  }

  async isAvailable(): Promise<boolean> {
    return this.credentials.hasCredentials();
  }

  private normalizeResponse(data: unknown): QuotaSnapshot {
    const access = asRecord(asRecord(data)?.access);
    const meters = asRecord(access?.meters);
    if (!meters) {
      debug('[ApiFetcher] access.meters missing');
      throw new ParseError('Status response has no usage meters');
    }

    debug(`[ApiFetcher] meter keys: ${Object.keys(meters).join(', ')}`);

    const now = Date.now();
    const rolling = toWindow(meters.fiveHour, now);
    const weekly = toWindow(meters.week, now);
    const monthly = toWindow(meters.month, now);

    debug(
      `[ApiFetcher] percents: rolling=${rolling.usagePercent.toFixed(2)} (${rolling.status}), ` +
        `weekly=${weekly.usagePercent.toFixed(2)} (${weekly.status}), ` +
        `monthly=${monthly.usagePercent.toFixed(2)} (${monthly.status})`,
    );

    if (rolling.status === 'unknown' && weekly.status === 'unknown' && monthly.status === 'unknown') {
      throw new ParseError('Status response has no valid usage meters');
    }

    return { timestamp: now, rolling, weekly, monthly, source: 'api' };
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
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

function toWindow(meter: unknown, now: number): QuotaWindow {
  const m = asRecord(meter);
  if (!m) {
    return { ...UNKNOWN_WINDOW };
  }

  const limit = toNumber(m.limitMicroCents);
  const used = toNumber(m.usedMicroCents);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) {
    return { ...UNKNOWN_WINDOW };
  }

  const resetsAt = typeof m.resetsAt === 'string' ? Date.parse(m.resetsAt) : NaN;
  const resetsInSeconds = Number.isFinite(resetsAt)
    ? Math.max(0, Math.round((resetsAt - now) / 1000))
    : 0;

  return { status: 'ok', usagePercent: (used / limit) * 100, resetsInSeconds };
}
