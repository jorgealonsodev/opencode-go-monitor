import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ScrapingFetcher } from '../src/fetchers/ScrapingFetcher';
import { CredentialsError, ParseError, NetworkError } from '../src/domain/errors';
import type { CredentialsStorage } from '../src/storage/credentials';

function createMockCredentialsStorage(
  hasCreds: boolean,
): CredentialsStorage {
  return {
    getCredentials: vi.fn(async () =>
      hasCreds
        ? { authCookie: 'auth=session=abc123', workspaceId: 'wrk_01KKKYPCYDAY6DQDY1VK1AJ2QT' }
        : null,
    ),
    hasCredentials: vi.fn(async () => hasCreds),
    saveCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    maskCookie: vi.fn((c: string) => c),
  } as unknown as CredentialsStorage;
}

const fixturePath = join(__dirname, 'fixtures', 'dashboard.html');
const dashboardHtml = readFileSync(fixturePath, 'utf-8');

describe('ScrapingFetcher', () => {
  describe('fetch', () => {
    it('parses real HTML fixture correctly', async () => {
      const fetchFn = vi.fn(async () =>
        new Response(dashboardHtml, { status: 200 }),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ScrapingFetcher(creds, fetchFn);

      const snapshot = await fetcher.fetch();

      expect(snapshot.source).toBe('scraping');
      expect(snapshot.rolling.status).toBe('ok');
      expect(snapshot.rolling.usagePercent).toBe(29);
      expect(snapshot.rolling.resetsInSeconds).toBe(3471);
      expect(snapshot.weekly.status).toBe('ok');
      expect(snapshot.weekly.usagePercent).toBe(11);
      expect(snapshot.weekly.resetsInSeconds).toBe(464797);
      expect(snapshot.monthly.status).toBe('ok');
      expect(snapshot.monthly.usagePercent).toBe(37);
      expect(snapshot.monthly.resetsInSeconds).toBe(1811918);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });

    it('throws CredentialsError when credentials are missing', async () => {
      const creds = createMockCredentialsStorage(false);
      const fetcher = new ScrapingFetcher(creds);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(CredentialsError);
    });

    it('throws NetworkError when fetch throws', async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      });
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ScrapingFetcher(creds, fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(NetworkError);
    });

    it('throws NetworkError on non-OK HTTP status', async () => {
      const fetchFn = vi.fn(async () =>
        new Response('Unauthorized', { status: 401 }),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ScrapingFetcher(creds, fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(NetworkError);
      await expect(fetcher.fetch()).rejects.toThrow('HTTP 401');
    });

    it('parses new HTML format with separate $R references correctly', async () => {
      // New format where each usage window has its own separate $R reference index
      const newFormatHtml = `
        <html><body>
        <script>
        self.$R=self.$R||[];
        $R[24]($R[18],$R[25]={mine:!0,useBalance:!1,
          rollingUsage:$R[30]={status:"ok",resetInSec:17562,usagePercent:1},
          weeklyUsage:$R[31]={status:"ok",resetInSec:533388,usagePercent:5},
          monthlyUsage:$R[32]={status:"ok",resetInSec:2485309,usagePercent:19}
        });
        </script>
        </body></html>`;
      const fetchFn = vi.fn(async () =>
        new Response(newFormatHtml, { status: 200 }),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ScrapingFetcher(creds, fetchFn);

      const snapshot = await fetcher.fetch();

      expect(snapshot.source).toBe('scraping');
      expect(snapshot.rolling.status).toBe('ok');
      expect(snapshot.rolling.usagePercent).toBe(1);
      expect(snapshot.rolling.resetsInSeconds).toBe(17562);
      expect(snapshot.weekly.status).toBe('ok');
      expect(snapshot.weekly.usagePercent).toBe(5);
      expect(snapshot.weekly.resetsInSeconds).toBe(533388);
      expect(snapshot.monthly.status).toBe('ok');
      expect(snapshot.monthly.usagePercent).toBe(19);
      expect(snapshot.monthly.resetsInSeconds).toBe(2485309);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });

    it('parses current HTML format with decimal usagePercent and extra usage/limit fields', async () => {
      // Format observed 2026-09: usagePercent may be fractional and is followed by usage/limit
      const currentFormatHtml = `
        <html><body>
        <script>
        self.$R=self.$R||[];
        $R[28]($R[18],$R[32]={mine:!0,useBalance:!1,allowTraining:!1,region:$R[33]=["us","eu","sg","cn"],
          rollingUsage:$R[34]={status:"ok",resetInSec:7060,usagePercent:0.1,usage:860207,limit:1200000000},
          weeklyUsage:$R[35]={status:"ok",resetInSec:487487,usagePercent:0.2,usage:6416273,limit:3000000000},
          monthlyUsage:$R[36]={status:"ok",resetInSec:703697,usagePercent:21,usage:1262472346,limit:6000000000}
        });
        </script>
        </body></html>`;
      const fetchFn = vi.fn(async () =>
        new Response(currentFormatHtml, { status: 200 }),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ScrapingFetcher(creds, fetchFn);

      const snapshot = await fetcher.fetch();

      expect(snapshot.rolling.status).toBe('ok');
      expect(snapshot.rolling.usagePercent).toBeCloseTo(0.1);
      expect(snapshot.rolling.resetsInSeconds).toBe(7060);
      expect(snapshot.weekly.status).toBe('ok');
      expect(snapshot.weekly.usagePercent).toBeCloseTo(0.2);
      expect(snapshot.weekly.resetsInSeconds).toBe(487487);
      expect(snapshot.monthly.status).toBe('ok');
      expect(snapshot.monthly.usagePercent).toBe(21);
      expect(snapshot.monthly.resetsInSeconds).toBe(703697);
    });

    it('throws ParseError when HTML lacks quota data', async () => {
      const fetchFn = vi.fn(async () =>
        new Response('<html><body>no data here</body></html>', { status: 200 }),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ScrapingFetcher(creds, fetchFn);

      await expect(fetcher.fetch()).rejects.toBeInstanceOf(ParseError);
    });

    it('uses correct URL with workspaceId', async () => {
      const fetchFn = vi.fn(async () =>
        new Response(dashboardHtml, { status: 200 }),
      );
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ScrapingFetcher(creds, fetchFn);

      await fetcher.fetch();

      expect(fetchFn).toHaveBeenCalledWith(
        'https://opencode.ai/workspace/wrk_01KKKYPCYDAY6DQDY1VK1AJ2QT/go',
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: 'auth=session=abc123',
          }),
        }),
      );
    });
  });

  describe('isAvailable', () => {
    it('returns true when credentials exist', async () => {
      const creds = createMockCredentialsStorage(true);
      const fetcher = new ScrapingFetcher(creds);
      expect(await fetcher.isAvailable()).toBe(true);
    });

    it('returns false when credentials are missing', async () => {
      const creds = createMockCredentialsStorage(false);
      const fetcher = new ScrapingFetcher(creds);
      expect(await fetcher.isAvailable()).toBe(false);
    });
  });
});
