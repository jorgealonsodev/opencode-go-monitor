import type { QuotaFetcher, QuotaSnapshot } from '../domain/types';
import { NetworkError } from '../domain/errors';
import type { ApiFetcher } from './ApiFetcher';
import type { ScrapingFetcher } from './ScrapingFetcher';
import type { HistoryStorage } from '../storage/history';

export const BACKOFF_STAGES = [60, 300, 900, 1800] as const;
export const MAX_BACKOFF = 1800;

const debug = (msg: string) => {
  if (typeof globalThis.opencodeGoQuotaDebug === 'function') {
    globalThis.opencodeGoQuotaDebug(msg);
  }
};

export class FetcherSelector implements QuotaFetcher {
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly apiFetcher: ApiFetcher,
    private readonly scrapingFetcher: ScrapingFetcher,
    private readonly historyStorage: HistoryStorage,
  ) {}

  async fetch(): Promise<QuotaSnapshot> {
    debug('[FetcherSelector] === fetch started ===');
    
    const cached = await this.historyStorage.getCachedStrategy();
    debug(`[FetcherSelector] cached strategy: ${cached?.strategy ?? 'none'}`);

    if (cached?.strategy === 'scraping') {
      debug('[FetcherSelector] using cached scraping strategy');
      return this.scrapingFetcher.fetch();
    }

    // Cached 'api' or no cache (auto-detect)
    debug('[FetcherSelector] trying API fetcher...');
    try {
      const snapshot = await this.apiFetcher.fetch();
      this.recordSuccess();
      if (!cached || cached.strategy !== 'api') {
        debug('[FetcherSelector] API success, caching strategy=api');
        await this.historyStorage.setCachedStrategy('api');
      }
      return snapshot;
    } catch (err) {
      const isNotFound = err instanceof NetworkError && (err.status === 404 || err.status === 501);
      debug(`[FetcherSelector] API failed: ${err instanceof Error ? err.message : String(err)} (isNotFound: ${isNotFound})`);
      
      this.recordFailure();
      
      if (isNotFound) {
        debug('[FetcherSelector] API not available, switching to scraping');
        await this.historyStorage.setCachedStrategy('scraping');
      }

      // Fallback to scraping
      debug('[FetcherSelector] falling back to scraping fetcher...');
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
