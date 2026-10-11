import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HistoryStorage,
  LEGACY_HISTORY_KEY,
  deleteAllHistory,
  deleteHistory,
  historyKey,
  migrateLegacyHistory,
} from '../src/storage/history';
import type { QuotaSnapshot } from '../src/domain/types';
import { predictExhaustion } from '../src/domain/prediction';
import { createMemento } from './fakes';

function makeSnapshot(timestamp: number, profileId = 'p1', pct = 10): QuotaSnapshot {
  return {
    timestamp,
    rolling: { status: 'ok', usagePercent: 10, resetsInSeconds: 3600 },
    weekly: { status: 'ok', usagePercent: 30, resetsInSeconds: 86400 },
    monthly: { status: 'ok', usagePercent: pct, resetsInSeconds: 2592000 },
    profileId,
  };
}

/** A pre-1.0 entry: carries `source` and has no `profileId`. */
function legacyEntry(timestamp: number, source: 'api' | 'scraping') {
  const { profileId: _omit, ...rest } = makeSnapshot(timestamp);
  return { ...rest, source };
}

describe('HistoryStorage', () => {
  let memento: ReturnType<typeof createMemento>;
  let active: { id: string; name: string } | undefined;
  let storage: HistoryStorage;

  beforeEach(() => {
    memento = createMemento();
    active = { id: 'p1', name: 'Personal' };
    storage = new HistoryStorage(memento, () => active);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('append', () => {
    it('stores a snapshot under its profile key', async () => {
      const now = Date.now();
      const snapshot = makeSnapshot(now);
      await storage.append(snapshot);
      expect(memento.data.get(historyKey('p1'))).toEqual([snapshot]);
      expect(memento.data.has(LEGACY_HISTORY_KEY)).toBe(false);
      expect(storage.getAll()).toEqual([snapshot]);
    });

    it('keeps profiles isolated and reads only the active one', async () => {
      const now = Date.now();
      await storage.append(makeSnapshot(now - 1000, 'p1'));
      await storage.append(makeSnapshot(now, 'p2'));
      await storage.append(makeSnapshot(now, 'p1'));

      expect(storage.getAll()).toHaveLength(2);
      expect(storage.getAll().every((s) => s.profileId === 'p1')).toBe(true);

      active = { id: 'p2', name: 'Team' };
      expect(storage.getAll()).toEqual([makeSnapshot(now, 'p2')]);
    });

    it('returns nothing without an active profile', async () => {
      await storage.append(makeSnapshot(Date.now(), 'p1'));
      active = undefined;
      expect(storage.getAll()).toEqual([]);
    });
  });

  it('predictions use only the active profile history', async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    // p2 burns quota fast; p1 is flat.
    for (let i = 0; i < 6; i++) {
      await storage.append(makeSnapshot(now - (6 - i) * 600_000, 'p1', 10));
      await storage.append(makeSnapshot(now - (6 - i) * 600_000, 'p2', 10 + i * 10));
    }
    const p1Prediction = predictExhaustion(storage.getAll());
    active = { id: 'p2', name: 'Team' };
    const p2Prediction = predictExhaustion(storage.getAll());

    expect(p1Prediction).toBeNull();
    expect(p2Prediction).not.toBeNull();
  });

  describe('cleanup', () => {
    it('removes snapshots older than 30 days in every profile', async () => {
      const now = Date.now();
      vi.setSystemTime(now);
      const recent = makeSnapshot(now - 15 * 24 * 60 * 60 * 1000);
      await storage.append(recent);
      await storage.append(makeSnapshot(now - 31 * 24 * 60 * 60 * 1000));
      await storage.append(makeSnapshot(now - 31 * 24 * 60 * 60 * 1000, 'p2'));
      await storage.cleanup();
      expect(storage.getAll()).toEqual([recent]);
      expect(memento.data.get(historyKey('p2'))).toEqual([]);
    });

    it('keeps only the most recent 10000 snapshots', async () => {
      const now = Date.now();
      vi.setSystemTime(now);
      const entries = Array.from({ length: 10005 }, (_, i) => makeSnapshot(now - i * 1000));
      await memento.update(historyKey('p1'), entries);
      await storage.cleanup();
      expect(storage.getAll()).toHaveLength(10000);
      expect(storage.getAll()[0].timestamp).toBe(now);
    });

    it('leaves the legacy key untouched', async () => {
      const legacy = [legacyEntry(1, 'scraping')];
      await memento.update(LEGACY_HISTORY_KEY, legacy);
      await storage.cleanup();
      expect(memento.data.get(LEGACY_HISTORY_KEY)).toEqual(legacy);
    });
  });

  describe('exportToJson', () => {
    it('exports the active profile as { profile, entries }', async () => {
      const now = Date.now();
      const snapshot = makeSnapshot(now);
      await storage.append(snapshot);
      await storage.append(makeSnapshot(now, 'p2'));
      expect(JSON.parse(storage.exportToJson()!)).toEqual({ profile: 'Personal', entries: [snapshot] });
    });

    it('returns undefined with zero entries or no active profile', async () => {
      expect(storage.exportToJson()).toBeUndefined();
      await storage.append(makeSnapshot(Date.now()));
      active = undefined;
      expect(storage.exportToJson()).toBeUndefined();
    });

    it('never exports legacy fields', async () => {
      await memento.update(historyKey('p1'), [{ ...makeSnapshot(1), source: 'scraping' }]);
      expect(storage.exportToJson()).not.toContain('scraping');
      expect(storage.getAll()[0]).not.toHaveProperty('source');
    });
  });
});

describe('migrateLegacyHistory (AC10)', () => {
  it('moves N legacy entries to the profile key and deletes the legacy key', async () => {
    const legacy = [legacyEntry(1, 'scraping'), legacyEntry(2, 'api'), legacyEntry(3, 'scraping')];
    const memento = createMemento({ [LEGACY_HISTORY_KEY]: legacy });

    await migrateLegacyHistory(memento, 'new-id');

    expect(memento.data.has(LEGACY_HISTORY_KEY)).toBe(false);
    const moved = memento.data.get(historyKey('new-id')) as QuotaSnapshot[];
    expect(moved).toHaveLength(3);
    expect(moved.map((e) => e.timestamp)).toEqual([1, 2, 3]);
    expect(moved.every((e) => e.profileId === 'new-id')).toBe(true);
    expect(JSON.stringify(moved)).not.toContain('source');

    // Idempotent: a second run changes nothing.
    await migrateLegacyHistory(memento, 'new-id');
    expect(memento.data.get(historyKey('new-id'))).toEqual(moved);
    expect(memento.data.has(LEGACY_HISTORY_KEY)).toBe(false);
  });

  it('merges with entries already stored for the profile, oldest first', async () => {
    const memento = createMemento({
      [LEGACY_HISTORY_KEY]: [legacyEntry(1, 'scraping')],
      [historyKey('p1')]: [makeSnapshot(5)],
    });
    await migrateLegacyHistory(memento, 'p1');
    expect((memento.data.get(historyKey('p1')) as QuotaSnapshot[]).map((e) => e.timestamp)).toEqual([1, 5]);
  });

  it('does not duplicate entries when re-run after an interrupted migration (R3-migration-interrupt-duplicates)', async () => {
    const legacy = [legacyEntry(1, 'scraping'), legacyEntry(2, 'api')];
    const memento = createMemento({ [LEGACY_HISTORY_KEY]: legacy });
    // Simulate an interruption: the profile key was written, the legacy key was not deleted.
    const update = vi.mocked(memento.update);
    update.mockImplementationOnce(update.getMockImplementation()!).mockImplementationOnce(async () => {
      throw new Error('interrupted');
    });
    await expect(migrateLegacyHistory(memento, 'p1')).rejects.toThrow('interrupted');
    expect(memento.data.has(LEGACY_HISTORY_KEY)).toBe(true);

    await memento.update(historyKey('p1'), [...(memento.data.get(historyKey('p1')) as QuotaSnapshot[]), makeSnapshot(3)]);
    await migrateLegacyHistory(memento, 'p1');

    expect((memento.data.get(historyKey('p1')) as QuotaSnapshot[]).map((e) => e.timestamp)).toEqual([1, 2, 3]);
    expect(memento.data.has(LEGACY_HISTORY_KEY)).toBe(false);
  });

  it('does nothing without a legacy key', async () => {
    const memento = createMemento();
    await migrateLegacyHistory(memento, 'p1');
    expect(memento.update).not.toHaveBeenCalled();
  });
});

describe('deleteHistory / deleteAllHistory', () => {
  it('deletes one profile or every profile history, never the legacy key', async () => {
    const memento = createMemento({
      [historyKey('p1')]: [makeSnapshot(1, 'p1')],
      [historyKey('p2')]: [makeSnapshot(1, 'p2')],
      [historyKey('p3')]: [makeSnapshot(1, 'p3')],
      [LEGACY_HISTORY_KEY]: [legacyEntry(1, 'api')],
    });

    await deleteHistory(memento, 'p1');
    expect(memento.data.has(historyKey('p1'))).toBe(false);
    expect(memento.data.has(historyKey('p2'))).toBe(true);

    await deleteAllHistory(memento);
    expect(memento.data.has(historyKey('p2'))).toBe(false);
    expect(memento.data.has(historyKey('p3'))).toBe(false);
    expect(memento.data.has(LEGACY_HISTORY_KEY)).toBe(true);
  });
});
