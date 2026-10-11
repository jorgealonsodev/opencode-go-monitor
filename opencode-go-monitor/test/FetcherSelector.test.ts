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
    it('uses apiFetcher and never calls scrapingFetcher', async () => {
      vi.mocked(apiFetcher.fetch).mockResolvedValue(mockSnapshot);

      const result = await selector.fetch();

      expect(result).toBe(mockSnapshot);
      expect(apiFetcher.fetch).toHaveBeenCalledTimes(1);
      expect(scrapingFetcher.fetch).not.toHaveBeenCalled();
    });

    it('ignores a cached scraping strategy', async () => {
      vi.mocked(historyStorage.getCachedStrategy).mockResolvedValue({
        strategy: 'scraping',
        timestamp: Date.now(),
      });
      vi.mocked(apiFetcher.fetch).mockResolvedValue(mockSnapshot);

      const result = await selector.fetch();

      expect(result).toBe(mockSnapshot);
      expect(scrapingFetcher.fetch).not.toHaveBeenCalled();
    });

    it('propagates API errors without falling back to scraping', async () => {
      vi.mocked(apiFetcher.fetch).mockRejectedValue(new NetworkError('Server Error', 500));

      await expect(selector.fetch()).rejects.toBeInstanceOf(NetworkError);
      expect(scrapingFetcher.fetch).not.toHaveBeenCalled();
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
    it('delegates to apiFetcher.isAvailable', async () => {
      vi.mocked(apiFetcher.isAvailable).mockResolvedValue(true);
      expect(await selector.isAvailable()).toBe(true);

      vi.mocked(apiFetcher.isAvailable).mockResolvedValue(false);
      expect(await selector.isAvailable()).toBe(false);
      expect(scrapingFetcher.isAvailable).not.toHaveBeenCalled();
    });
  });
});
