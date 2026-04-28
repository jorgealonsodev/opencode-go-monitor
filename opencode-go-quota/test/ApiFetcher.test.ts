import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiFetcher } from '../src/fetchers/ApiFetcher';
import { CredentialsError, NetworkError } from '../src/domain/errors';
import type { CredentialsStorage } from '../src/storage/credentials';

function createMockCredentialsStorage(
  hasCreds: boolean,
): CredentialsStorage {
  return {
    getCredentials: vi.fn(async () =>
      hasCreds
        ? { authCookie: 'session=abc123', workspaceId: 'wrk_test' }
        : null,
    ),
    hasCredentials: vi.fn(async () => hasCreds),
    saveCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    maskCookie: vi.fn((c: string) => c),
  } as unknown as CredentialsStorage;
}

describe('ApiFetcher', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  describe('fetch', () => {
    it('returns QuotaSnapshot from JSON response', async () => {
      const fetchFn = vi.fn(async () =>
        new Response(
          JSON.stringify({
            rolling: { status: 'ok', usagePercent: 29, resetsInSeconds: 3471 },
            weekly: { status: 'ok', usagePercent: 11, resetsInSeconds: 464797 },
            monthly: { status: 'ok', usagePercent: 37, resetsInSeconds: 1811918 },
          }),
          { status: 200 },
        ),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ApiFetcher(creds, fetchFn);

      const snapshot = await fetcher.fetch();

      expect(snapshot.source).toBe('api');
      expect(snapshot.rolling.status).toBe('ok');
      expect(snapshot.rolling.usagePercent).toBe(29);
      expect(snapshot.rolling.resetsInSeconds).toBe(3471);
      expect(snapshot.weekly.status).toBe('ok');
      expect(snapshot.weekly.usagePercent).toBe(11);
      expect(snapshot.weekly.resetsInSeconds).toBe(464797);
      expect(snapshot.monthly.status).toBe('ok');
      expect(snapshot.monthly.usagePercent).toBe(37);
      expect(snapshot.monthly.resetsInSeconds).toBe(1811918);
    });

    it('normalizes resetInSec to resetsInSeconds', async () => {
      const fetchFn = vi.fn(async () =>
        new Response(
          JSON.stringify({
            rolling: { status: 'ok', usagePercent: 50, resetInSec: 3600 },
            weekly: { status: 'ok', usagePercent: 20, resetInSec: 7200 },
            monthly: { status: 'ok', usagePercent: 80, resetInSec: 86400 },
          }),
          { status: 200 },
        ),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ApiFetcher(creds, fetchFn);

      const snapshot = await fetcher.fetch();
      expect(snapshot.rolling.resetsInSeconds).toBe(3600);
      expect(snapshot.weekly.resetsInSeconds).toBe(7200);
      expect(snapshot.monthly.resetsInSeconds).toBe(86400);
    });

    it('throws CredentialsError when credentials are missing', async () => {
      const creds = createMockCredentialsStorage(false);
      const fetcher = new ApiFetcher(creds);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(CredentialsError);
    });

    it('throws NetworkError when fetch throws', async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      });
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ApiFetcher(creds, fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(NetworkError);
    });

    it('throws NetworkError on non-OK HTTP status', async () => {
      const fetchFn = vi.fn(async () =>
        new Response('Not Found', { status: 404 }),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ApiFetcher(creds, fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(NetworkError);
      await expect(fetcher.fetch()).rejects.toThrow('HTTP 404');
    });

    it('uses correct URL and cookie header', async () => {
      const fetchFn = vi.fn(async () =>
        new Response(
          JSON.stringify({
            rolling: { status: 'ok', usagePercent: 0, resetsInSeconds: 0 },
            weekly: { status: 'ok', usagePercent: 0, resetsInSeconds: 0 },
            monthly: { status: 'ok', usagePercent: 0, resetsInSeconds: 0 },
          }),
          { status: 200 },
        ),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ApiFetcher(creds, fetchFn);

      await fetcher.fetch();

      expect(fetchFn).toHaveBeenCalledWith(
        'https://console.opencode.ai/zen/go/v1/usage',
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: 'session=abc123',
          }),
        }),
      );
    });
  });

  describe('isAvailable', () => {
    it('returns true when API responds 200', async () => {
      const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ApiFetcher(creds, fetchFn);

      expect(await fetcher.isAvailable()).toBe(true);
    });

    it('returns false when API responds non-200', async () => {
      const fetchFn = vi.fn(async () => new Response('Not Found', { status: 404 }));
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ApiFetcher(creds, fetchFn);

      expect(await fetcher.isAvailable()).toBe(false);
    });

    it('returns false when credentials are missing', async () => {
      const creds = createMockCredentialsStorage(false);
      const fetcher = new ApiFetcher(creds);

      expect(await fetcher.isAvailable()).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error('Network error');
      });
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ApiFetcher(creds, fetchFn);

      expect(await fetcher.isAvailable()).toBe(false);
    });
  });
});
