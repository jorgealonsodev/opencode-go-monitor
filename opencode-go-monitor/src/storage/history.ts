import type { QuotaSnapshot } from '../domain/types';

export interface MementoLike {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: any): Thenable<void>;
  keys(): readonly string[];
}

/** Pre-1.0 single history list; moved to the first profile when it is created. */
export const LEGACY_HISTORY_KEY = 'opencodeGoQuota.history';
const HISTORY_KEY_PREFIX = `${LEGACY_HISTORY_KEY}.`;
export const historyKey = (profileId: string): string => `${HISTORY_KEY_PREFIX}${profileId}`;

const MAX_AGE_DAYS = 30;
const MAX_SNAPSHOTS = 10000;

/**
 * An entry as found in globalState. Pre-1.0 entries lack `profileId` and may
 * carry fields the domain no longer uses; those are dropped by `toEntry`.
 */
type StoredEntry = Omit<QuotaSnapshot, 'profileId'> & { profileId?: string };

/** Keeps only the fields the domain uses, so legacy fields are never written again or exported. */
function toEntry(stored: StoredEntry, profileId: string): QuotaSnapshot {
  return {
    timestamp: stored.timestamp,
    profileId: stored.profileId ?? profileId,
    rolling: stored.rolling,
    weekly: stored.weekly,
    monthly: stored.monthly,
  };
}

function read(memento: MementoLike, key: string, profileId: string): QuotaSnapshot[] {
  return (memento.get<StoredEntry[]>(key) ?? []).map((entry) => toEntry(entry, profileId));
}

/** The profile whose history is read, shown and exported. */
export interface HistoryProfile {
  id: string;
  name: string;
}

/**
 * Quota history per profile (`opencodeGoQuota.history.<profileId>`). Snapshots are
 * appended to their own profile's list; reads and exports use only the active profile.
 */
export class HistoryStorage {
  constructor(
    private readonly memento: MementoLike,
    private readonly activeProfile: () => HistoryProfile | undefined,
  ) {}

  async append(snapshot: QuotaSnapshot): Promise<void> {
    const key = historyKey(snapshot.profileId);
    const history = read(this.memento, key, snapshot.profileId);
    history.push(toEntry(snapshot, snapshot.profileId));
    await this.memento.update(key, history);
  }

  /** History of the active profile (empty without one). */
  getAll(): QuotaSnapshot[] {
    const profile = this.activeProfile();
    return profile ? read(this.memento, historyKey(profile.id), profile.id) : [];
  }

  /** Trims every profile's history by age and size. The legacy key is never touched. */
  async cleanup(): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (const key of this.memento.keys().filter((k) => k.startsWith(HISTORY_KEY_PREFIX))) {
      const profileId = key.slice(HISTORY_KEY_PREFIX.length);
      const stored = this.memento.get<StoredEntry[]>(key) ?? [];
      let history = read(this.memento, key, profileId).filter((s) => s.timestamp >= cutoff);
      if (history.length > MAX_SNAPSHOTS) {
        history = history.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_SNAPSHOTS);
      }
      if (history.length !== stored.length) {
        await this.memento.update(key, history);
      }
    }
  }

  /** `{ profile, entries }` for the active profile; undefined when there is nothing to export. */
  exportToJson(): string | undefined {
    const profile = this.activeProfile();
    const entries = this.getAll();
    if (!profile || entries.length === 0) {
      return undefined;
    }
    return JSON.stringify({ profile: profile.name, entries });
  }
}

/**
 * Moves the pre-1.0 history to `profileId` (entries without a profile id get it)
 * and deletes the legacy key. Idempotent: does nothing once the legacy key is gone,
 * and a re-run after an interruption (profile key written, legacy key not yet
 * deleted) skips entries already present, matched by timestamp.
 */
export async function migrateLegacyHistory(memento: MementoLike, profileId: string): Promise<void> {
  const legacy = memento.get<StoredEntry[]>(LEGACY_HISTORY_KEY);
  if (legacy === undefined) {
    return;
  }
  const key = historyKey(profileId);
  const byTimestamp = new Map<number, QuotaSnapshot>();
  for (const entry of [...read(memento, key, profileId), ...legacy.map((e) => toEntry(e, profileId))]) {
    if (!byTimestamp.has(entry.timestamp)) {
      byTimestamp.set(entry.timestamp, entry);
    }
  }
  const merged = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  await memento.update(key, merged);
  await memento.update(LEGACY_HISTORY_KEY, undefined);
}

export async function deleteHistory(memento: MementoLike, profileId: string): Promise<void> {
  await memento.update(historyKey(profileId), undefined);
}

/** Deletes every profile's history (including orphans); the legacy key is left alone. */
export async function deleteAllHistory(memento: MementoLike): Promise<void> {
  const keys = memento.keys().filter((k) => k.startsWith(HISTORY_KEY_PREFIX));
  await Promise.all(keys.map((key) => memento.update(key, undefined)));
}
