import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiFetcher } from '../src/fetchers/ApiFetcher';
import { CredentialsError, NetworkError, ParseError } from '../src/domain/errors';
import type { CredentialsStorage } from '../src/storage/credentials';

const STATUS_URL = 'https://opencode.ai/console/api/go/status';
const NOW = new Date('2026-10-11T22:00:00.000Z');

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'go-status.json'), 'utf8'),
) as Record<string, unknown>;

function createMockCredentialsStorage(
  hasCreds: boolean,
  authCookie = 'auth=session=abc123',
): CredentialsStorage {
  return {
    getCredentials: vi.fn(async () =>
      hasCreds ? { authCookie, workspaceId: 'wrk_TEST' } : null,
    ),
    hasCredentials: vi.fn(async () => hasCreds),
    saveCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    maskCookie: vi.fn(() => '***'),
  } as unknown as CredentialsStorage;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function withMeters(meters: unknown): Record<string, unknown> {
  return { ...fixture, access: { ...(fixture.access as object), meters } };
}

describe('ApiFetcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetch', () => {
    it('calls the console status endpoint with cookie, org id and accept headers', async () => {
      const fetchFn = vi.fn(async () => jsonResponse(fixture));
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      await fetcher.fetch();

      expect(fetchFn).toHaveBeenCalledWith(
        STATUS_URL,
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: 'auth=session=abc123',
            'x-org-id': 'wrk_TEST',
            Accept: 'application/json',
          }),
        }),
      );
    });

    it('prefixes the cookie with auth= when missing', async () => {
      const fetchFn = vi.fn(async () => jsonResponse(fixture));
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true, 'rawtoken'), fetchFn);

      await fetcher.fetch();

      expect(fetchFn).toHaveBeenCalledWith(
        STATUS_URL,
        expect.objectContaining({
          headers: expect.objectContaining({ Cookie: 'auth=rawtoken' }),
        }),
      );
    });

    it('maps fiveHour/week/month meters to rolling/weekly/monthly percentages', async () => {
      const fetchFn = vi.fn(async () => jsonResponse(fixture));
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      const snapshot = await fetcher.fetch();

      expect(snapshot.source).toBe('api');
      expect(snapshot.timestamp).toBe(NOW.getTime());
      expect(snapshot.rolling.status).toBe('ok');
      expect(snapshot.rolling.usagePercent).toBeCloseTo((13977529 / 1200000000) * 100, 6);
      expect(snapshot.weekly.status).toBe('ok');
      expect(snapshot.weekly.usagePercent).toBeCloseTo((2805449221 / 3000000000) * 100, 6);
      expect(snapshot.monthly.status).toBe('ok');
      expect(snapshot.monthly.usagePercent).toBeCloseTo((4215514992 / 6000000000) * 100, 6);
    });

    it('computes resetsInSeconds from resetsAt relative to now', async () => {
      const fetchFn = vi.fn(async () => jsonResponse(fixture));
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      const snapshot = await fetcher.fetch();

      // 22:00:00 -> 01:07:28 next day
      expect(snapshot.rolling.resetsInSeconds).toBe(3 * 3600 + 7 * 60 + 28);
      // 22:00:00 -> 00:00:00 next day
      expect(snapshot.weekly.resetsInSeconds).toBe(2 * 3600);
      // 2026-10-11T22:00:00Z -> 2026-10-27T09:29:18Z
      expect(snapshot.monthly.resetsInSeconds).toBe(15 * 86400 + 11 * 3600 + 29 * 60 + 18);
    });

    it('clamps resetsInSeconds to 0 when resetsAt is in the past', async () => {
      vi.setSystemTime(new Date('2026-10-28T00:00:00.000Z'));
      const fetchFn = vi.fn(async () => jsonResponse(fixture));
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      const snapshot = await fetcher.fetch();

      expect(snapshot.rolling.resetsInSeconds).toBe(0);
      expect(snapshot.monthly.resetsInSeconds).toBe(0);
    });

    it('accepts numeric meter values and does not clamp percent above 100', async () => {
      const fetchFn = vi.fn(async () =>
        jsonResponse(
          withMeters({
            fiveHour: { resetsAt: '2026-10-11T23:00:00.000Z', limitMicroCents: 100, usedMicroCents: 150 },
            week: { resetsAt: '2026-10-12T00:00:00.000Z', limitMicroCents: 200, usedMicroCents: 50 },
            month: { resetsAt: '2026-10-27T09:29:18.000Z', limitMicroCents: 400, usedMicroCents: 0 },
          }),
        ),
      );
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      const snapshot = await fetcher.fetch();

      expect(snapshot.rolling.usagePercent).toBe(150);
      expect(snapshot.weekly.usagePercent).toBe(25);
      expect(snapshot.monthly.usagePercent).toBe(0);
      expect(snapshot.monthly.status).toBe('ok');
    });

    it('marks a window unknown when its meter is missing or invalid', async () => {
      const fetchFn = vi.fn(async () =>
        jsonResponse(
          withMeters({
            fiveHour: (fixture.access as { meters: Record<string, unknown> }).meters.fiveHour,
            week: { resetsAt: '2026-10-12T00:00:00.000Z', limitMicroCents: '0', usedMicroCents: '10' },
            // month missing
          }),
        ),
      );
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      const snapshot = await fetcher.fetch();

      expect(snapshot.rolling.status).toBe('ok');
      expect(snapshot.weekly).toEqual({ status: 'unknown', usagePercent: 0, resetsInSeconds: 0 });
      expect(snapshot.monthly).toEqual({ status: 'unknown', usagePercent: 0, resetsInSeconds: 0 });
    });

    it('throws ParseError when all meters are missing or invalid', async () => {
      const fetchFn = vi.fn(async () =>
        jsonResponse(
          withMeters({
            fiveHour: { limitMicroCents: 'abc', usedMicroCents: '1' },
            week: null,
          }),
        ),
      );
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(ParseError);
    });

    it('throws ParseError when access is missing', async () => {
      const fetchFn = vi.fn(async () => jsonResponse({ product: 'go' }));
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(ParseError);
    });

    it('throws ParseError when the body is not JSON', async () => {
      const fetchFn = vi.fn(async () => new Response('<html></html>', { status: 200 }));
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(ParseError);
    });

    it('throws CredentialsError when credentials are missing', async () => {
      const fetchFn = vi.fn();
      const fetcher = new ApiFetcher(createMockCredentialsStorage(false), fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(CredentialsError);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('throws NetworkError when fetch throws', async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      });
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(NetworkError);
    });

    it('throws NetworkError with status on non-OK HTTP response', async () => {
      const fetchFn = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      const err = await fetcher.fetch().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NetworkError);
      expect((err as NetworkError).status).toBe(401);
      expect((err as NetworkError).message).toBe('HTTP 401');
    });

    it('never logs the cookie value', async () => {
      const logs: string[] = [];
      globalThis.opencodeGoQuotaDebug = (msg: string) => logs.push(msg);
      try {
        const fetchFn = vi.fn(async () => jsonResponse(fixture));
        const fetcher = new ApiFetcher(
          createMockCredentialsStorage(true, 'auth=supersecretvalue'),
          fetchFn,
        );
        await fetcher.fetch();
      } finally {
        globalThis.opencodeGoQuotaDebug = undefined;
      }

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain('supersecretvalue');
    });
  });

  describe('isAvailable', () => {
    it('returns true when credentials exist without making a request', async () => {
      const fetchFn = vi.fn();
      const fetcher = new ApiFetcher(createMockCredentialsStorage(true), fetchFn);

      expect(await fetcher.isAvailable()).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('returns false when credentials are missing', async () => {
      const fetcher = new ApiFetcher(createMockCredentialsStorage(false), vi.fn());

      expect(await fetcher.isAvailable()).toBe(false);
    });
  });
});
