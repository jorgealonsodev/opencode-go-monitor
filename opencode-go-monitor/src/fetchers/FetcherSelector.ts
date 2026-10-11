import type { QuotaFetcher, QuotaSnapshot } from '../domain/types';
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
    // The console status JSON API is the only supported strategy. The SSR
    // scraping strategy stopped working when the Go page became a client-rendered SPA.
    debug('[FetcherSelector] using API strategy (console status endpoint)');
    return this.apiFetcher.fetch();
  }

  async isAvailable(): Promise<boolean> {
    return this.apiFetcher.isAvailable();
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
