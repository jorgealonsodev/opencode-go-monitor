import type { QuotaSnapshot } from '../domain/types';

export interface MementoLike {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: any): Thenable<void>;
  keys(): readonly string[];
}

const STORAGE_KEY = 'opencodeGoQuota.history';
const STRATEGY_CACHE_KEY = 'opencodeGoQuota.fetcherStrategy';
const MAX_AGE_DAYS = 30;
const MAX_SNAPSHOTS = 10000;
const STRATEGY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface StrategyCacheEntry {
  strategy: 'api' | 'scraping';
  timestamp: number;
}

export class HistoryStorage {
  constructor(private readonly memento: MementoLike) {}

  async append(snapshot: QuotaSnapshot): Promise<void> {
    const history = [...this.getAll()];
    history.push(snapshot);
    await this.memento.update(STORAGE_KEY, history);
  }

  getAll(): QuotaSnapshot[] {
    return this.memento.get<QuotaSnapshot[]>(STORAGE_KEY) ?? [];
  }

  getLast24h(): QuotaSnapshot[] {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return this.getAll().filter((s) => s.timestamp >= cutoff);
  }

  async cleanup(): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    let history = this.getAll().filter((s) => s.timestamp >= cutoff);

    if (history.length > MAX_SNAPSHOTS) {
      history = history
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_SNAPSHOTS);
    }

    await this.memento.update(STORAGE_KEY, history);
  }

  exportToJson(): string {
    return JSON.stringify(this.getAll());
  }

  async getCachedStrategy(): Promise<StrategyCacheEntry | null> {
    const entry = this.memento.get<StrategyCacheEntry>(STRATEGY_CACHE_KEY);
    if (!entry) {
      return null;
    }
    const age = Date.now() - entry.timestamp;
    if (age > STRATEGY_CACHE_TTL_MS) {
      return null;
    }
    return entry;
  }

  async setCachedStrategy(strategy: 'api' | 'scraping'): Promise<void> {
    await this.memento.update(STRATEGY_CACHE_KEY, {
      strategy,
      timestamp: Date.now(),
    });
  }

  async clearCachedStrategy(): Promise<void> {
    await this.memento.update(STRATEGY_CACHE_KEY, undefined);
  }
}
