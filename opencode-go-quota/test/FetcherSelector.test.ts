import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetcherSelector, BACKOFF_STAGES, MAX_BACKOFF } from '../src/fetchers/FetcherSelector';
import { NetworkError } from '../src/domain/errors';
import type { ApiFetcher } from '../src/fetchers/ApiFetcher';
import type { ScrapingFetcher } from '../src/fetchers/ScrapingFetcher';
import type { HistoryStorage } from '../src/storage/history';
import type { QuotaSnapshot } from '../src/domain/types';

function createMockApiFetcher(): ApiFetcher {
  return {
    fetch: vi.fn(),
    isAvailable: vi.fn(async () => true),
  } as unknown as ApiFetcher;
}

function createMockScrapingFetcher(): ScrapingFetcher {
  return {
    fetch: vi.fn(),
    isAvailable: vi.fn(async () => true),
  } as unknown as ScrapingFetcher;
}

function createMockHistoryStorage(): HistoryStorage {
  let cache: { strategy: 'api' | 'scraping'; timestamp: number } | null = null;
  return {
    getCachedStrategy: vi.fn(async () => {
      if (!cache) return null;
      const age = Date.now() - cache.timestamp;
      if (age > 24 * 60 * 60 * 1000) return null;
      return cache;
    }),
    setCachedStrategy: vi.fn(async (strategy: 'api' | 'scraping') => {
      cache = { strategy, timestamp: Date.now() };
    }),
    clearCachedStrategy: vi.fn(async () => {
      cache = null;
    }),
    append: vi.fn(),
    getAll: vi.fn(() => []),
    getLast24h: vi.fn(() => []),
    cleanup: vi.fn(),
    exportToJson: vi.fn(() => '[]'),
  } as unknown as HistoryStorage;
}

const mockSnapshot: QuotaSnapshot = {
  timestamp: Date.now(),
  rolling: { status: 'ok', usagePercent: 10, resetsInSeconds: 100 },
  weekly: { status: 'ok', usagePercent: 20, resetsInSeconds: 200 },
  monthly: { status: 'ok', usagePercent: 30, resetsInSeconds: 300 },
  source: 'api',
};

describe('FetcherSelector', () => {
  let apiFetcher: ApiFetcher;
  let scrapingFetcher: ScrapingFetcher;
  let historyStorage: HistoryStorage;
  let selector: FetcherSelector;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiFetcher = createMockApiFetcher();
    scrapingFetcher = createMockScrapingFetcher();
    historyStorage = createMockHistoryStorage();
    selector = new FetcherSelector(apiFetcher, scrapingFetcher, historyStorage);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetch', () => {
    it('uses ApiFetcher when it succeeds', async () => {
      vi.mocked(apiFetcher.fetch).mockResolvedValue(mockSnapshot);

      const result = await selector.fetch();

      expect(result).toBe(mockSnapshot);
      expect(apiFetcher.fetch).toHaveBeenCalledTimes(1);
      expect(scrapingFetcher.fetch).not.toHaveBeenCalled();
      expect(historyStorage.setCachedStrategy).toHaveBeenCalledWith('api');
    });

    it('falls back to ScrapingFetcher on API 404', async () => {
      vi.mocked(apiFetcher.fetch).mockRejectedValue(new NetworkError('Not Found', 404));
      vi.mocked(scrapingFetcher.fetch).mockResolvedValue({ ...mockSnapshot, source: 'scraping' });

      const result = await selector.fetch();

      expect(result.source).toBe('scraping');
      expect(apiFetcher.fetch).toHaveBeenCalledTimes(1);
      expect(scrapingFetcher.fetch).toHaveBeenCalledTimes(1);
      expect(historyStorage.setCachedStrategy).toHaveBeenCalledWith('scraping');
    });

    it('falls back to ScrapingFetcher on API 501', async () => {
      vi.mocked(apiFetcher.fetch).mockRejectedValue(new NetworkError('Not Implemented', 501));
      vi.mocked(scrapingFetcher.fetch).mockResolvedValue({ ...mockSnapshot, source: 'scraping' });

      const result = await selector.fetch();

      expect(result.source).toBe('scraping');
      expect(historyStorage.setCachedStrategy).toHaveBeenCalledWith('scraping');
    });

    it('falls back to ScrapingFetcher on other API errors without caching scraping', async () => {
      vi.mocked(apiFetcher.fetch).mockRejectedValue(new NetworkError('Server Error', 500));
      vi.mocked(scrapingFetcher.fetch).mockResolvedValue({ ...mockSnapshot, source: 'scraping' });

      const result = await selector.fetch();

      expect(result.source).toBe('scraping');
      expect(historyStorage.setCachedStrategy).not.toHaveBeenCalledWith('scraping');
    });

    it('uses cached api strategy directly', async () => {
      vi.mocked(historyStorage.getCachedStrategy).mockResolvedValue({
        strategy: 'api',
        timestamp: Date.now(),
      });
      vi.mocked(apiFetcher.fetch).mockResolvedValue(mockSnapshot);

      const result = await selector.fetch();

      expect(result).toBe(mockSnapshot);
      expect(apiFetcher.fetch).toHaveBeenCalledTimes(1);
      expect(scrapingFetcher.fetch).not.toHaveBeenCalled();
    });

    it('uses cached scraping strategy directly', async () => {
      vi.mocked(historyStorage.getCachedStrategy).mockResolvedValue({
        strategy: 'scraping',
        timestamp: Date.now(),
      });
      vi.mocked(scrapingFetcher.fetch).mockResolvedValue({ ...mockSnapshot, source: 'scraping' });

      const result = await selector.fetch();

      expect(result.source).toBe('scraping');
      expect(apiFetcher.fetch).not.toHaveBeenCalled();
      expect(scrapingFetcher.fetch).toHaveBeenCalledTimes(1);
    });

    it('ignores expired cache and reverts to auto-detect', async () => {
      vi.mocked(historyStorage.getCachedStrategy).mockResolvedValue(null);
      vi.mocked(apiFetcher.fetch).mockResolvedValue(mockSnapshot);

      const result = await selector.fetch();

      expect(result).toBe(mockSnapshot);
      expect(apiFetcher.fetch).toHaveBeenCalledTimes(1);
    });

    it('propagates error when both fetchers fail', async () => {
      vi.mocked(apiFetcher.fetch).mockRejectedValue(new NetworkError('Timeout', 504));
      vi.mocked(scrapingFetcher.fetch).mockRejectedValue(new NetworkError('Bad Gateway', 502));

      await expect(selector.fetch()).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe('backoff', () => {
    it('starts with 0 delay', () => {
      expect(selector.getBackoffDelay()).toBe(0);
    });

    it('increments backoff stage on failure', () => {
      selector.recordFailure();
      expect(selector.getBackoffDelay()).toBe(BACKOFF_STAGES[0]);

      selector.recordFailure();
      expect(selector.getBackoffDelay()).toBe(BACKOFF_STAGES[1]);

      selector.recordFailure();
      expect(selector.getBackoffDelay()).toBe(BACKOFF_STAGES[2]);

      selector.recordFailure();
      expect(selector.getBackoffDelay()).toBe(BACKOFF_STAGES[3]);
    });

    it('caps backoff at MAX_BACKOFF', () => {
      for (let i = 0; i < 10; i++) {
        selector.recordFailure();
      }
      expect(selector.getBackoffDelay()).toBe(MAX_BACKOFF);
    });

    it('resets backoff on success', () => {
      selector.recordFailure();
      selector.recordFailure();
      expect(selector.getBackoffDelay()).toBe(BACKOFF_STAGES[1]);

      selector.recordSuccess();
      expect(selector.getBackoffDelay()).toBe(0);
    });

    it('returns remaining backoff time when inside backoff period', () => {
      selector.recordFailure(); // stage 0 = 60s
      expect(selector.getBackoffDelay()).toBe(60);

      vi.advanceTimersByTime(30_000);
      expect(selector.getBackoffDelay()).toBe(30);

      vi.advanceTimersByTime(30_000);
      expect(selector.getBackoffDelay()).toBe(0);
    });

    it('returns 0 delay after backoff period expires', () => {
      selector.recordFailure();
      vi.advanceTimersByTime(BACKOFF_STAGES[0] * 1000 + 1);
      expect(selector.getBackoffDelay()).toBe(0);
    });
  });

  describe('isAvailable', () => {
    it('delegates to scrapingFetcher.isAvailable', async () => {
      vi.mocked(scrapingFetcher.isAvailable).mockResolvedValue(true);
      expect(await selector.isAvailable()).toBe(true);

      vi.mocked(scrapingFetcher.isAvailable).mockResolvedValue(false);
      expect(await selector.isAvailable()).toBe(false);
    });
  });
});
