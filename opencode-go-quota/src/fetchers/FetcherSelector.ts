import type { QuotaFetcher, QuotaSnapshot } from '../domain/types';
import { NetworkError } from '../domain/errors';
import type { ApiFetcher } from './ApiFetcher';
import type { ScrapingFetcher } from './ScrapingFetcher';
import type { HistoryStorage } from '../storage/history';

export const BACKOFF_STAGES = [60, 300, 900, 1800] as const;
export const MAX_BACKOFF = 1800;

export class FetcherSelector implements QuotaFetcher {
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly apiFetcher: ApiFetcher,
    private readonly scrapingFetcher: ScrapingFetcher,
    private readonly historyStorage: HistoryStorage,
  ) {}

  async fetch(): Promise<QuotaSnapshot> {
    const cached = await this.historyStorage.getCachedStrategy();

    if (cached?.strategy === 'scraping') {
      return this.scrapingFetcher.fetch();
    }

    // Cached 'api' or no cache (auto-detect)
    try {
      const snapshot = await this.apiFetcher.fetch();
      this.recordSuccess();
      if (!cached || cached.strategy !== 'api') {
        await this.historyStorage.setCachedStrategy('api');
      }
      return snapshot;
    } catch (err) {
      const isNotFound = err instanceof NetworkError && (err.status === 404 || err.status === 501);

      if (isNotFound) {
        this.recordFailure();
        await this.historyStorage.setCachedStrategy('scraping');
      } else {
        this.recordFailure();
      }

      // Fallback to scraping
      return this.scrapingFetcher.fetch();
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.scrapingFetcher.isAvailable();
  }

  getBackoffDelay(): number {
    if (this.failureCount === 0) {
      return 0;
    }
    const stage = Math.min(this.failureCount - 1, BACKOFF_STAGES.length - 1);
    const delaySeconds = BACKOFF_STAGES[stage];
    const elapsedSeconds = (Date.now() - this.lastFailureTime) / 1000;
    return Math.max(0, Math.ceil(delaySeconds - elapsedSeconds));
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
  }
}
