import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HistoryStorage } from '../src/storage/history';
import type { MementoLike } from '../src/storage/history';
import type { QuotaSnapshot } from '../src/domain/types';

function createMockMemento(): MementoLike {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => store.get(key) ?? defaultValue) as MementoLike['get'],
    update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }) as MementoLike['update'],
    keys: vi.fn(() => Array.from(store.keys())) as MementoLike['keys'],
  };
}

function makeSnapshot(timestamp: number): QuotaSnapshot {
  return {
    timestamp,
    rolling: { status: 'ok', usagePercent: 10, resetsInSeconds: 3600 },
    weekly: { status: 'ok', usagePercent: 30, resetsInSeconds: 86400 },
    monthly: { status: 'ok', usagePercent: 50, resetsInSeconds: 2592000 },
    source: 'api',
  };
}

describe('HistoryStorage', () => {
  let memento: MementoLike;
  let storage: HistoryStorage;

  beforeEach(() => {
    memento = createMockMemento();
    storage = new HistoryStorage(memento);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('append', () => {
    it('adds a snapshot to history', async () => {
      const now = Date.now();
      vi.setSystemTime(now);
      const snapshot = makeSnapshot(now);
      await storage.append(snapshot);
      expect(storage.getAll()).toHaveLength(1);
      expect(storage.getAll()[0]).toEqual(snapshot);
    });

    it('appends multiple snapshots', async () => {
      const now = Date.now();
      vi.setSystemTime(now);
      await storage.append(makeSnapshot(now - 1000));
      await storage.append(makeSnapshot(now));
      expect(storage.getAll()).toHaveLength(2);
    });
  });

  describe('getAll', () => {
    it('returns empty array when no history', () => {
      expect(storage.getAll()).toEqual([]);
    });
  });

  describe('getLast24h', () => {
    it('returns only snapshots from the last 24 hours', async () => {
      const now = Date.now();
      vi.setSystemTime(now);
      const recent = makeSnapshot(now - 12 * 60 * 60 * 1000);
      const old = makeSnapshot(now - 25 * 60 * 60 * 1000);
      await storage.append(recent);
      await storage.append(old);
      const result = storage.getLast24h();
      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe(recent.timestamp);
    });

    it('returns empty array when no recent snapshots', async () => {
      const now = Date.now();
      vi.setSystemTime(now);
      await storage.append(makeSnapshot(now - 25 * 60 * 60 * 1000));
      expect(storage.getLast24h()).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('removes snapshots older than 30 days', async () => {
      const now = Date.now();
      vi.setSystemTime(now);
      const recent = makeSnapshot(now - 15 * 24 * 60 * 60 * 1000);
      const old = makeSnapshot(now - 31 * 24 * 60 * 60 * 1000);
      await storage.append(recent);
      await storage.append(old);
      await storage.cleanup();
      expect(storage.getAll()).toHaveLength(1);
      expect(storage.getAll()[0].timestamp).toBe(recent.timestamp);
    });

    it('keeps only the most recent 10000 snapshots', async () => {
      const now = Date.now();
      vi.setSystemTime(now);
      for (let i = 0; i < 10005; i++) {
        await storage.append(makeSnapshot(now - i * 1000));
      }
      await storage.cleanup();
      expect(storage.getAll()).toHaveLength(10000);
      expect(storage.getAll()[0].timestamp).toBe(now);
    });
  });

  describe('exportToJson', () => {
    it('returns JSON string of all history', async () => {
      const now = Date.now();
      vi.setSystemTime(now);
      const snapshot = makeSnapshot(now);
      await storage.append(snapshot);
      const json = storage.exportToJson();
      expect(JSON.parse(json)).toEqual([snapshot]);
    });
  });
});
