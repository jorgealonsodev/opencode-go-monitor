import { randomUUID } from 'crypto';
import type { ActiveKey, ActiveKeyProvider } from '../domain/types';
import { deleteAllHistory, deleteHistory, migrateLegacyHistory, type MementoLike } from './history';

export interface SecretStorageLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

/** A named API key. The key itself lives only in SecretStorage, keyed by `id`. */
export interface Profile {
  id: string;
  name: string;
  createdAt: number;
}

export const PROFILES_KEY = 'opencodeGoQuota.profiles';
export const ACTIVE_PROFILE_KEY = 'opencodeGoQuota.activeProfileId';
export const MIGRATION_NOTICE_KEY = 'opencodeGoQuota.migrationNoticeShown';
export const apiKeySecretKey = (id: string): string => `opencodeGoQuota.apiKey.${id}`;

export const MAX_NAME_LENGTH = 40;
export const MAX_KEY_LENGTH = 512;
const MIN_KEY_LENGTH_FOR_HINT = 12;

const FORBIDDEN_NAME_CHARS = /[[\]()\p{Cc}]/u;
const INVALID_KEY_CHARS = /[\s\p{Cc}]/u;

export type NameValidationError = 'required' | 'tooLong' | 'forbidden' | 'duplicate';
export type ProfileValidationReason = NameValidationError | 'invalidKey';

export class ProfileValidationError extends Error {
  constructor(public readonly reason: ProfileValidationReason) {
    super(`Invalid profile input: ${reason}`);
    this.name = 'ProfileValidationError';
  }
}

export function normalizeProfileName(raw: string): string {
  return raw.trim().normalize('NFC');
}

/**
 * Validates a profile name against FR1. `excludeId` skips the profile being
 * renamed so it does not collide with itself.
 */
export function validateProfileName(
  raw: string,
  existing: readonly Profile[],
  excludeId?: string,
): NameValidationError | undefined {
  const name = normalizeProfileName(raw);
  if (name.length === 0) {
    return 'required';
  }
  if ([...name].length > MAX_NAME_LENGTH) {
    return 'tooLong';
  }
  if (FORBIDDEN_NAME_CHARS.test(name)) {
    return 'forbidden';
  }
  const duplicate = existing.some(
    (p) => p.id !== excludeId && p.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
  );
  return duplicate ? 'duplicate' : undefined;
}

export function normalizeApiKey(raw: string): string {
  return raw.trim();
}

export function isValidApiKey(raw: string): boolean {
  const key = normalizeApiKey(raw);
  return key.length >= 1 && [...key].length <= MAX_KEY_LENGTH && !INVALID_KEY_CHARS.test(key);
}

/** Last-4 hint for key-management quick picks only; never persisted or logged. */
export function keyHint(key: string): string {
  return key.length < MIN_KEY_LENGTH_FOR_HINT ? '…' : `…${key.slice(-4)}`;
}

/**
 * Named API keys: profile records in globalState, keys in SecretStorage.
 * Nothing here is registered with `setKeysForSync`.
 */
export class ProfileStore implements ActiveKeyProvider {
  /**
   * Last key known per profile (memory only), so a transient `undefined` from
   * SecretStorage (e.g. a slow Linux keyring) does not drop polling into setup.
   */
  private readonly keyCache = new Map<string, string>();

  constructor(
    private readonly memento: MementoLike,
    private readonly secrets: SecretStorageLike,
    private readonly newId: () => string = randomUUID,
  ) {}

  list(): Profile[] {
    return [...(this.memento.get<Profile[]>(PROFILES_KEY) ?? [])];
  }

  /** The active profile; a stale active id (e.g. removed in another window) falls back to the first profile. */
  getActiveProfile(): Profile | undefined {
    const profiles = this.list();
    const activeId = this.memento.get<string>(ACTIVE_PROFILE_KEY);
    return profiles.find((p) => p.id === activeId) ?? profiles[0];
  }

  async getActive(): Promise<ActiveKey | null> {
    const profile = this.getActiveProfile();
    if (!profile) {
      return null;
    }
    const stored = await this.secrets.get(apiKeySecretKey(profile.id));
    if (stored) {
      this.keyCache.set(profile.id, stored);
    }
    const key = stored ?? this.keyCache.get(profile.id);
    return key ? { id: profile.id, name: profile.name, key } : null;
  }

  async add(rawName: string, rawKey: string): Promise<Profile> {
    const profiles = this.list();
    const nameError = validateProfileName(rawName, profiles);
    if (nameError) {
      throw new ProfileValidationError(nameError);
    }
    if (!isValidApiKey(rawKey)) {
      throw new ProfileValidationError('invalidKey');
    }

    const profile: Profile = { id: this.newId(), name: normalizeProfileName(rawName), createdAt: Date.now() };
    const key = normalizeApiKey(rawKey);
    // Secret first: a profile record must never point at a missing key.
    await this.secrets.store(apiKeySecretKey(profile.id), key);
    this.keyCache.set(profile.id, key);
    await this.memento.update(PROFILES_KEY, [...profiles, profile]);
    if (profiles.length === 0) {
      await this.memento.update(ACTIVE_PROFILE_KEY, profile.id);
      // FR4: pre-1.0 history belongs to the first profile.
      await migrateLegacyHistory(this.memento, profile.id);
    }
    return profile;
  }

  async rename(id: string, rawName: string): Promise<void> {
    const profiles = this.list();
    const nameError = validateProfileName(rawName, profiles, id);
    if (nameError) {
      throw new ProfileValidationError(nameError);
    }
    const name = normalizeProfileName(rawName);
    await this.memento.update(
      PROFILES_KEY,
      profiles.map((p) => (p.id === id ? { ...p, name } : p)),
    );
  }

  async replaceKey(id: string, rawKey: string): Promise<void> {
    if (!isValidApiKey(rawKey)) {
      throw new ProfileValidationError('invalidKey');
    }
    if (!this.list().some((p) => p.id === id)) {
      return;
    }
    const key = normalizeApiKey(rawKey);
    this.keyCache.delete(id);
    await this.secrets.store(apiKeySecretKey(id), key);
    this.keyCache.set(id, key);
  }

  async setActive(id: string): Promise<void> {
    if (this.list().some((p) => p.id === id)) {
      await this.memento.update(ACTIVE_PROFILE_KEY, id);
    }
  }

  /** Removes a profile, its key and its history; returns the active profile afterwards. */
  async remove(id: string): Promise<Profile | undefined> {
    const profiles = this.list();
    const index = profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      return this.getActiveProfile();
    }
    const wasActive = this.getActiveProfile()?.id === id;
    const remaining = profiles.filter((p) => p.id !== id);

    this.keyCache.delete(id);
    await this.secrets.delete(apiKeySecretKey(id));
    await this.memento.update(PROFILES_KEY, remaining);
    await deleteHistory(this.memento, id);

    if (wasActive) {
      const next = remaining[index] ?? remaining[index - 1];
      await this.memento.update(ACTIVE_PROFILE_KEY, next?.id);
    }
    return this.getActiveProfile();
  }

  /** Removes every profile, key and history. */
  async removeAll(): Promise<void> {
    const profiles = this.list();
    this.keyCache.clear();
    await Promise.all(profiles.map((p) => this.secrets.delete(apiKeySecretKey(p.id))));
    await this.memento.update(PROFILES_KEY, undefined);
    await this.memento.update(ACTIVE_PROFILE_KEY, undefined);
    await deleteAllHistory(this.memento);
  }

  async getKeyHint(id: string): Promise<string> {
    const key = await this.secrets.get(apiKeySecretKey(id));
    return key ? keyHint(key) : '…';
  }
}

// Legacy removal (FR1). This is the only place that still names pre-1.0 storage
// keys; delete it once no supported upgrade path comes from ≤ 0.1.4.
const LEGACY_SECRET_KEYS = [
  'opencodeGoQuota.authCookie',
  'opencodeGoQuota.workspaceId',
  'opencodeGoQuota.cookieTimestamp',
];
const LEGACY_STRATEGY_CACHE_KEY = 'opencodeGoQuota.fetcherStrategy';

/**
 * Idempotently deletes cookie-era data. Calls `notify` once, only when a legacy
 * secret existed and the notice has not been shown before.
 */
export async function removeLegacyData(
  memento: MementoLike,
  secrets: SecretStorageLike,
  notify: () => void,
): Promise<void> {
  const present = await Promise.all(LEGACY_SECRET_KEYS.map((key) => secrets.get(key)));
  const hadLegacy = present.some((value) => value !== undefined);

  await Promise.all(LEGACY_SECRET_KEYS.map((key) => secrets.delete(key)));
  if (memento.get(LEGACY_STRATEGY_CACHE_KEY) !== undefined) {
    await memento.update(LEGACY_STRATEGY_CACHE_KEY, undefined);
  }

  if (hadLegacy && !memento.get<boolean>(MIGRATION_NOTICE_KEY)) {
    await memento.update(MIGRATION_NOTICE_KEY, true);
    notify();
  }
}
