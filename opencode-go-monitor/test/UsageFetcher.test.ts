import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageFetcher, USAGE_URL, UNEXPECTED_RESPONSE_MESSAGE } from '../src/fetchers/UsageFetcher';
import { AuthError, CredentialsError, NetworkError, ParseError } from '../src/domain/errors';
import type { ActiveKey, ActiveKeyProvider } from '../src/domain/types';
import type { FetchFn } from '../src/fetchers/types';

const NOW = new Date('2026-10-11T22:00:00.000Z');
const SYNTHETIC_KEY = 'zq9X-SYNTH-7vKp-Wm3R-qL8d';
const PROFILE: ActiveKey = { id: 'profile-1', name: 'Team One', key: SYNTHETIC_KEY };

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'zen-usage.json'), 'utf8'),
) as { usage: Record<string, unknown> };

function provider(active: ActiveKey | null = PROFILE): ActiveKeyProvider {
  return { getActive: vi.fn(async () => active) };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function withUsage(usage: Record<string, unknown>): Record<string, unknown> {
  return { usage: { ...fixture.usage, ...usage } };
}

function fetcherFor(response: Response | (() => Promise<Response>), active?: ActiveKey | null) {
  const fetchFn = vi.fn<FetchFn>(async () =>
    typeof response === 'function' ? response() : response,
  );
  const fetcher = new UsageFetcher(provider(active === undefined ? PROFILE : active), { fetchFn });
  return { fetcher, fetchFn };
}

describe('UsageFetcher', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.opencodeGoQuotaDebug = undefined;
  });

  describe('request shape (AC3)', () => {
    it('calls the constant URL with bearer auth, accept, user agent, redirect error and a signal', async () => {
      const { fetcher, fetchFn } = fetcherFor(jsonResponse(fixture));

      await fetcher.fetch();

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe('https://opencode.ai/zen/go/v1/usage');
      expect(USAGE_URL).toBe('https://opencode.ai/zen/go/v1/usage');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
      expect(headers.Accept).toBe('application/json');
      expect(headers['User-Agent']).toMatch(/^opencode-go-monitor\/\d+\.\d+\.\d+$/);
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('mapping (AC1, AC2)', () => {
    it('maps the fixture to a snapshot bound to the active profile', async () => {
      const { fetcher } = fetcherFor(jsonResponse(fixture));

      const snapshot = await fetcher.fetch();

      expect(snapshot.profileId).toBe('profile-1');
      expect(snapshot.timestamp).toBe(NOW.getTime());
      expect(snapshot).not.toHaveProperty('source');
      expect(snapshot.rolling).toEqual({ status: 'limit-reached', usagePercent: 100, resetsInSeconds: 2 * 3600 + 13 * 60 });
      expect(snapshot.weekly).toEqual({
        status: 'ok',
        usagePercent: 42,
        resetsInSeconds: (Date.parse('2026-10-15T00:00:00.000Z') - NOW.getTime()) / 1000,
      });
      expect(snapshot.monthly).toEqual({
        status: 'ok',
        usagePercent: 21,
        resetsInSeconds: (Date.parse('2026-11-01T00:00:00.000Z') - NOW.getTime()) / 1000,
      });
    });

    it('forces 100% on a rate-limited window regardless of the reported percent', async () => {
      const { fetcher } = fetcherFor(
        jsonResponse(withUsage({ rolling: { status: 'rate-limited', percent: 87, resetsAt: '2026-10-11T23:00:00.000Z' } })),
      );

      const snapshot = await fetcher.fetch();

      expect(snapshot.rolling.status).toBe('limit-reached');
      expect(snapshot.rolling.usagePercent).toBe(100);
    });

    it('maps an unrecognized status string to unknown', async () => {
      const { fetcher } = fetcherFor(
        jsonResponse(withUsage({ weekly: { status: 'something-new', percent: 10, resetsAt: '2026-10-15T00:00:00.000Z' } })),
      );

      const snapshot = await fetcher.fetch();

      expect(snapshot.weekly.status).toBe('unknown');
      expect(snapshot.rolling.status).toBe('limit-reached');
    });

    it('clamps percent to [0, 100]', async () => {
      const { fetcher } = fetcherFor(
        jsonResponse(
          withUsage({
            weekly: { status: 'ok', percent: 150, resetsAt: '2026-10-15T00:00:00.000Z' },
            monthly: { status: 'ok', percent: -5, resetsAt: '2026-11-01T00:00:00.000Z' },
          }),
        ),
      );

      const snapshot = await fetcher.fetch();

      expect(snapshot.weekly.usagePercent).toBe(100);
      expect(snapshot.monthly.usagePercent).toBe(0);
    });

    it('accepts a numeric string percent', async () => {
      const { fetcher } = fetcherFor(
        jsonResponse(withUsage({ weekly: { status: 'ok', percent: '37.5', resetsAt: '2026-10-15T00:00:00.000Z' } })),
      );

      const snapshot = await fetcher.fetch();

      expect(snapshot.weekly).toMatchObject({ status: 'ok', usagePercent: 37.5 });
    });

    it('marks a window with a non-finite percent as unknown', async () => {
      const { fetcher } = fetcherFor(
        jsonResponse(withUsage({ weekly: { status: 'ok', percent: 'abc', resetsAt: '2026-10-15T00:00:00.000Z' } })),
      );

      const snapshot = await fetcher.fetch();

      expect(snapshot.weekly.status).toBe('unknown');
      expect(snapshot.monthly.status).toBe('ok');
    });

    it('uses 0 seconds for a missing, invalid or past resetsAt without changing status', async () => {
      const { fetcher } = fetcherFor(
        jsonResponse({
          usage: {
            rolling: { status: 'ok', percent: 5 },
            weekly: { status: 'ok', percent: 6, resetsAt: 'not a date' },
            monthly: { status: 'ok', percent: 7, resetsAt: '2026-10-01T00:00:00.000Z' },
          },
        }),
      );

      const snapshot = await fetcher.fetch();

      expect(snapshot.rolling).toEqual({ status: 'ok', usagePercent: 5, resetsInSeconds: 0 });
      expect(snapshot.weekly).toEqual({ status: 'ok', usagePercent: 6, resetsInSeconds: 0 });
      expect(snapshot.monthly).toEqual({ status: 'ok', usagePercent: 7, resetsInSeconds: 0 });
    });
  });

  describe('partial and malformed responses (AC7)', () => {
    it('returns weekly unknown and valid others when weekly is missing', async () => {
      const usage = { ...fixture.usage };
      delete usage.weekly;
      const { fetcher } = fetcherFor(jsonResponse({ usage }));

      const snapshot = await fetcher.fetch();

      expect(snapshot.weekly.status).toBe('unknown');
      expect(snapshot.rolling.status).toBe('limit-reached');
      expect(snapshot.monthly).toMatchObject({ status: 'ok', usagePercent: 21 });
    });

    it('throws ParseError when usage is missing', async () => {
      const { fetcher } = fetcherFor(jsonResponse({ other: true }));

      const err = await fetcher.fetch().catch((e) => e);

      expect(err).toBeInstanceOf(ParseError);
      expect(err.message).toBe(UNEXPECTED_RESPONSE_MESSAGE);
      expect(UNEXPECTED_RESPONSE_MESSAGE).toBe('Unexpected response from OpenCode — the extension may need an update.');
    });

    it('throws ParseError for a non-JSON body', async () => {
      const { fetcher } = fetcherFor(new Response('<html>nope</html>', { status: 200 }));

      await expect(fetcher.fetch()).rejects.toThrow(ParseError);
    });

    it('throws ParseError when all three windows are invalid', async () => {
      const { fetcher } = fetcherFor(jsonResponse({ usage: { rolling: null, weekly: 'x', monthly: { status: 'ok', percent: 'NaN' } } }));

      await expect(fetcher.fetch()).rejects.toThrow(ParseError);
    });
  });

  describe('errors', () => {
    it('throws CredentialsError without calling the network when no profile is active', async () => {
      const { fetcher, fetchFn } = fetcherFor(jsonResponse(fixture), null);

      await expect(fetcher.fetch()).rejects.toThrow(CredentialsError);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it.each([401, 403])('throws AuthError naming the profile on %i', async (status) => {
      const { fetcher } = fetcherFor(jsonResponse({ error: 'nope' }, status));

      const err = await fetcher.fetch().catch((e) => e);

      expect(err).toBeInstanceOf(AuthError);
      expect(err.profileId).toBe('profile-1');
      expect(err.profileName).toBe('Team One');
      expect(err.httpStatus).toBe(status);
      expect(err.message).not.toContain(SYNTHETIC_KEY);
    });

    it('throws NetworkError with Retry-After seconds on 429', async () => {
      const { fetcher } = fetcherFor(jsonResponse({}, 429, { 'Retry-After': '120' }));

      const err = await fetcher.fetch().catch((e) => e);

      expect(err).toBeInstanceOf(NetworkError);
      expect(err.status).toBe(429);
      expect(err.retryAfterSeconds).toBe(120);
    });

    it('parses an HTTP-date Retry-After on 503', async () => {
      const retryAt = new Date(NOW.getTime() + 300_000).toUTCString();
      const { fetcher } = fetcherFor(jsonResponse({}, 503, { 'Retry-After': retryAt }));

      const err = await fetcher.fetch().catch((e) => e);

      expect(err).toBeInstanceOf(NetworkError);
      expect(err.status).toBe(503);
      expect(err.retryAfterSeconds).toBe(300);
    });

    it('leaves retryAfterSeconds undefined when Retry-After is absent or invalid', async () => {
      const { fetcher } = fetcherFor(jsonResponse({}, 429, { 'Retry-After': 'soon' }));

      const err = await fetcher.fetch().catch((e) => e);

      expect(err).toBeInstanceOf(NetworkError);
      expect(err.retryAfterSeconds).toBeUndefined();
    });

    it('throws NetworkError with status for other non-2xx responses', async () => {
      const { fetcher } = fetcherFor(jsonResponse({}, 500));

      const err = await fetcher.fetch().catch((e) => e);

      expect(err).toBeInstanceOf(NetworkError);
      expect(err.status).toBe(500);
    });

    it('throws ParseError on a 3xx response', async () => {
      const { fetcher } = fetcherFor(new Response(null, { status: 302, headers: { Location: 'https://example.com' } }));

      const err = await fetcher.fetch().catch((e) => e);

      expect(err).toBeInstanceOf(ParseError);
      expect(err.message).toBe(UNEXPECTED_RESPONSE_MESSAGE);
    });

    it('throws ParseError when fetch rejects because of a redirect', async () => {
      const { fetcher } = fetcherFor(() =>
        Promise.reject(new TypeError('fetch failed', { cause: new Error('unexpected redirect') })),
      );

      await expect(fetcher.fetch()).rejects.toThrow(ParseError);
    });

    it('throws NetworkError when offline', async () => {
      const { fetcher } = fetcherFor(() => Promise.reject(new TypeError('fetch failed')));

      await expect(fetcher.fetch()).rejects.toThrow(NetworkError);
    });
  });

  describe('timeout (AC5)', () => {
    it('fails with "Request timed out" when the request never resolves', async () => {
      vi.useRealTimers();
      const fetchFn = vi.fn<FetchFn>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      );
      const fetcher = new UsageFetcher(provider(), { fetchFn, timeoutMs: 20 });

      const err = await fetcher.fetch().catch((e) => e);

      expect(err).toBeInstanceOf(NetworkError);
      expect(err.message).toBe('Request timed out');
    });

    it('defaults to a 15 s timeout', () => {
      const spy = vi.spyOn(AbortSignal, 'timeout');
      const { fetcher } = fetcherFor(jsonResponse(fixture));

      return fetcher.fetch().then(() => {
        expect(spy).toHaveBeenCalledWith(15_000);
        spy.mockRestore();
      });
    });
  });

  describe('debug logging', () => {
    it('never logs the key or the profile name', async () => {
      const lines: string[] = [];
      globalThis.opencodeGoQuotaDebug = (msg: string) => lines.push(msg);
      const { fetcher } = fetcherFor(
        jsonResponse(withUsage({ weekly: { status: 'weird', percent: 500, resetsAt: '2026-10-15T00:00:00.000Z' } })),
      );

      await fetcher.fetch();
      await fetcherFor(jsonResponse({}, 401)).fetcher.fetch().catch(() => undefined);

      const output = lines.join('\n');
      expect(lines.length).toBeGreaterThan(0);
      for (let i = 0; i + 4 <= SYNTHETIC_KEY.length; i++) {
        expect(output).not.toContain(SYNTHETIC_KEY.slice(i, i + 4));
      }
      expect(output).not.toContain('Team One');
      expect(output).toContain(`[${SYNTHETIC_KEY.length} chars]`);
    });
  });

  describe('isAvailable', () => {
    it('reflects whether a profile is active', async () => {
      await expect(new UsageFetcher(provider()).isAvailable()).resolves.toBe(true);
      await expect(new UsageFetcher(provider(null)).isAvailable()).resolves.toBe(false);
    });
  });
});
