import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProfileStore,
  ProfileValidationError,
  validateProfileName,
  normalizeProfileName,
  isValidApiKey,
  normalizeApiKey,
  keyHint,
  removeLegacyData,
  PROFILES_KEY,
  ACTIVE_PROFILE_KEY,
  MIGRATION_NOTICE_KEY,
  apiKeySecretKey,
  type Profile,
} from '../src/storage/profiles';
import { LEGACY_HISTORY_KEY, historyKey } from '../src/storage/history';
import { createMemento, createSecrets } from './fakes';

const KEY_A = 'sk-test-aaaaaaaaaaaa1111';
const KEY_B = 'sk-test-bbbbbbbbbbbb2222';
const KEY_C = 'sk-test-cccccccccccc3333';

function profile(id: string, name: string): Profile {
  return { id, name, createdAt: 0 };
}

describe('profile name validation', () => {
  const existing = [profile('p1', 'Team'), profile('p2', 'café')];

  it('accepts a normal name', () => {
    expect(validateProfileName('Personal', existing)).toBeUndefined();
  });

  it('rejects empty and whitespace-only names', () => {
    expect(validateProfileName('', existing)).toBe('required');
    expect(validateProfileName('   \t ', existing)).toBe('required');
  });

  it('accepts 40 code points and rejects 41', () => {
    expect(validateProfileName('a'.repeat(40), [])).toBeUndefined();
    expect(validateProfileName('a'.repeat(41), [])).toBe('tooLong');
  });

  it('counts emoji as single code points', () => {
    expect(validateProfileName('🚀'.repeat(40), [])).toBeUndefined();
    expect(validateProfileName('🚀'.repeat(41), [])).toBe('tooLong');
    expect(validateProfileName('Team 🚀', [])).toBeUndefined();
  });

  it('measures length after trim', () => {
    expect(validateProfileName(`  ${'a'.repeat(40)}  `, [])).toBeUndefined();
  });

  it.each(['Team [1]', 'Team (1)', 'a]b', 'a(b', 'tab\there', 'bell\u0007', 'nl\nx'])(
    'rejects forbidden characters in %j',
    (name) => {
      expect(validateProfileName(name, [])).toBe('forbidden');
    },
  );

  it('rejects duplicates that differ only by case', () => {
    expect(validateProfileName('team', existing)).toBe('duplicate');
    expect(validateProfileName('  TEAM ', existing)).toBe('duplicate');
    expect(validateProfileName('CAFÉ', existing)).toBe('duplicate');
  });

  it('treats accent differences as distinct names (sensitivity: accent)', () => {
    expect(validateProfileName('cafe', existing)).toBeUndefined();
  });

  it('compares NFC-normalized names', () => {
    const decomposed = 'café';
    expect(normalizeProfileName(decomposed)).toBe('café');
    expect(validateProfileName(decomposed, existing)).toBe('duplicate');
  });

  it('ignores the profile being renamed', () => {
    expect(validateProfileName('team', existing, 'p1')).toBeUndefined();
    expect(validateProfileName('team', existing, 'p2')).toBe('duplicate');
  });
});

describe('API key validation', () => {
  it('accepts a trimmed key', () => {
    expect(isValidApiKey(`  ${KEY_A}\n`)).toBe(true);
    expect(normalizeApiKey(`  ${KEY_A}\n`)).toBe(KEY_A);
  });

  it('rejects empty, too long, and inner whitespace or control characters', () => {
    expect(isValidApiKey('')).toBe(false);
    expect(isValidApiKey('   ')).toBe(false);
    expect(isValidApiKey('a'.repeat(512))).toBe(true);
    expect(isValidApiKey('a'.repeat(513))).toBe(false);
    expect(isValidApiKey('abc def')).toBe(false);
    expect(isValidApiKey('abc\u0000def')).toBe(false);
  });
});

describe('keyHint', () => {
  it('shows only an ellipsis for keys shorter than 12 characters', () => {
    expect(keyHint('short-key')).toBe('…');
    expect(keyHint('12345678901')).toBe('…');
  });

  it('shows the last 4 characters otherwise', () => {
    expect(keyHint('123456789012')).toBe('…9012');
    expect(keyHint(KEY_A)).toBe('…1111');
  });
});

describe('ProfileStore', () => {
  let memento: ReturnType<typeof createMemento>;
  let secrets: ReturnType<typeof createSecrets>;
  let store: ProfileStore;
  let ids: string[];

  beforeEach(() => {
    memento = createMemento();
    secrets = createSecrets();
    ids = ['id-1', 'id-2', 'id-3'];
    store = new ProfileStore(memento, secrets, () => ids.shift()!);
  });

  it('starts empty with no active key', async () => {
    expect(store.list()).toEqual([]);
    expect(store.getActiveProfile()).toBeUndefined();
    expect(await store.getActive()).toBeNull();
  });

  it('adds a profile, stores the key in SecretStorage by id, and activates the first one', async () => {
    const p = await store.add('  Personal ', `  ${KEY_A} `);

    expect(p).toEqual({ id: 'id-1', name: 'Personal', createdAt: expect.any(Number) });
    expect(secrets.data.get(apiKeySecretKey('id-1'))).toBe(KEY_A);
    expect(memento.data.get(PROFILES_KEY)).toEqual([p]);
    expect(memento.data.get(ACTIVE_PROFILE_KEY)).toBe('id-1');
    expect(await store.getActive()).toEqual({ id: 'id-1', name: 'Personal', key: KEY_A });
  });

  it('does not activate later profiles automatically', async () => {
    await store.add('Personal', KEY_A);
    await store.add('Team 1', KEY_B);

    expect(store.list().map((p) => p.name)).toEqual(['Personal', 'Team 1']);
    expect(store.getActiveProfile()?.id).toBe('id-1');
  });

  it('never writes a key into globalState and never registers keys for sync', async () => {
    await store.add('Personal', KEY_A);
    await store.add('Team 1', KEY_B);
    await store.replaceKey('id-1', KEY_C);

    const serialized = JSON.stringify(Array.from(memento.data.entries()));
    for (const key of [KEY_A, KEY_B, KEY_C]) {
      expect(serialized).not.toContain(key);
    }
    expect(memento.setKeysForSync).not.toHaveBeenCalled();
  });

  it('rejects invalid names and keys on add', async () => {
    await store.add('Team', KEY_A);
    await expect(store.add('team', KEY_B)).rejects.toBeInstanceOf(ProfileValidationError);
    await expect(store.add('Other', 'bad key')).rejects.toBeInstanceOf(ProfileValidationError);
    expect(store.list()).toHaveLength(1);
  });

  it('renames without moving the secret', async () => {
    await store.add('Personal', KEY_A);
    await store.rename('id-1', ' Work ');

    expect(store.list()[0].name).toBe('Work');
    expect(secrets.data.get(apiKeySecretKey('id-1'))).toBe(KEY_A);
    expect(secrets.store).toHaveBeenCalledTimes(1);
  });

  it('rejects a rename to an existing name', async () => {
    await store.add('Personal', KEY_A);
    await store.add('Team', KEY_B);
    await expect(store.rename('id-1', 'TEAM')).rejects.toBeInstanceOf(ProfileValidationError);
  });

  it('replaces a key keeping id and name', async () => {
    await store.add('Personal', KEY_A);
    await store.replaceKey('id-1', KEY_B);

    expect(store.list()).toEqual([expect.objectContaining({ id: 'id-1', name: 'Personal' })]);
    expect(await store.getActive()).toEqual({ id: 'id-1', name: 'Personal', key: KEY_B });
  });

  it('switches the active profile', async () => {
    await store.add('Personal', KEY_A);
    await store.add('Team', KEY_B);
    await store.setActive('id-2');

    expect(await store.getActive()).toEqual({ id: 'id-2', name: 'Team', key: KEY_B });
  });

  it('removing the active profile activates the next one in the list', async () => {
    await store.add('A', KEY_A);
    await store.add('B', KEY_B);
    await store.add('C', KEY_C);

    const next = await store.remove('id-1');

    expect(next?.id).toBe('id-2');
    expect(store.getActiveProfile()?.id).toBe('id-2');
    expect(secrets.data.has(apiKeySecretKey('id-1'))).toBe(false);
  });

  it('removing the last profile in the list falls back to the previous one', async () => {
    await store.add('A', KEY_A);
    await store.add('B', KEY_B);
    await store.setActive('id-2');

    const next = await store.remove('id-2');
    expect(next?.id).toBe('id-1');
  });

  it('removing a non-active profile keeps the active one', async () => {
    await store.add('A', KEY_A);
    await store.add('B', KEY_B);

    const next = await store.remove('id-2');
    expect(next?.id).toBe('id-1');
    expect(store.list().map((p) => p.id)).toEqual(['id-1']);
  });

  it('removing the only profile leaves no active profile', async () => {
    await store.add('A', KEY_A);

    const next = await store.remove('id-1');

    expect(next).toBeUndefined();
    expect(store.list()).toEqual([]);
    expect(memento.data.has(ACTIVE_PROFILE_KEY)).toBe(false);
    expect(await store.getActive()).toBeNull();
  });

  it('removes all profiles and secrets', async () => {
    await store.add('A', KEY_A);
    await store.add('B', KEY_B);

    await store.removeAll();

    expect(store.list()).toEqual([]);
    expect(secrets.data.size).toBe(0);
    expect(await store.getActive()).toBeNull();
  });

  it('falls back to the first profile when the stored active id is stale', async () => {
    await store.add('A', KEY_A);
    await memento.update(ACTIVE_PROFILE_KEY, 'gone');

    expect(store.getActiveProfile()?.id).toBe('id-1');
  });

  it('returns null when the active profile key has never been readable', async () => {
    await store.add('A', KEY_A);
    secrets.data.clear();
    // A fresh store (e.g. another window) has never read this key.
    const fresh = new ProfileStore(memento, secrets);

    expect(await fresh.getActive()).toBeNull();
  });

  describe('key cache (transient SecretStorage misses)', () => {
    it('keeps the last key read when SecretStorage transiently returns undefined', async () => {
      await store.add('A', KEY_A);
      const fresh = new ProfileStore(memento, secrets);
      expect(await fresh.getActive()).toEqual({ id: 'id-1', name: 'A', key: KEY_A });

      vi.mocked(secrets.get).mockResolvedValueOnce(undefined);
      expect(await fresh.getActive()).toEqual({ id: 'id-1', name: 'A', key: KEY_A });
    });

    it('uses the key cached on add', async () => {
      await store.add('A', KEY_A);
      vi.mocked(secrets.get).mockResolvedValueOnce(undefined);
      expect(await store.getActive()).toEqual({ id: 'id-1', name: 'A', key: KEY_A });
    });

    it('uses the replaced key, never the old cached one', async () => {
      await store.add('A', KEY_A);
      await store.replaceKey('id-1', KEY_B);
      vi.mocked(secrets.get).mockResolvedValueOnce(undefined);
      expect((await store.getActive())?.key).toBe(KEY_B);
    });

    it('forgets cached keys on remove and remove all', async () => {
      await store.add('A', KEY_A);
      await store.remove('id-1');
      await memento.update(PROFILES_KEY, [profile('id-1', 'A')]);
      expect(await store.getActive()).toBeNull();

      await store.add('B', KEY_B);
      await store.removeAll();
      await memento.update(PROFILES_KEY, [profile('id-2', 'B')]);
      expect(await store.getActive()).toBeNull();
    });
  });

  it('reads the key hint on demand', async () => {
    await store.add('A', KEY_A);
    expect(await store.getKeyHint('id-1')).toBe('…1111');
    expect(await store.getKeyHint('missing')).toBe('…');
  });

  describe('history (FR4)', () => {
    const legacy = [
      { timestamp: 1, source: 'scraping', rolling: {}, weekly: {}, monthly: {} },
      { timestamp: 2, source: 'api', rolling: {}, weekly: {}, monthly: {} },
    ];

    it('moves the legacy history to the first profile when it is created (AC10)', async () => {
      await memento.update(LEGACY_HISTORY_KEY, legacy);
      await store.add('A', KEY_A);

      expect(memento.data.has(LEGACY_HISTORY_KEY)).toBe(false);
      const moved = memento.data.get(historyKey('id-1')) as Array<Record<string, unknown>>;
      expect(moved).toHaveLength(2);
      expect(moved.every((e) => e.profileId === 'id-1' && !('source' in e))).toBe(true);

      await store.add('B', KEY_B);
      expect(memento.data.has(historyKey('id-2'))).toBe(false);
    });

    it('removing a profile deletes only its history', async () => {
      await store.add('A', KEY_A);
      await store.add('B', KEY_B);
      await memento.update(historyKey('id-1'), [{ timestamp: 1 }]);
      await memento.update(historyKey('id-2'), [{ timestamp: 2 }]);

      await store.remove('id-1');

      expect(memento.data.has(historyKey('id-1'))).toBe(false);
      expect(memento.data.get(historyKey('id-2'))).toEqual([{ timestamp: 2 }]);
    });

    it('removing all profiles deletes every profile history', async () => {
      await memento.update(LEGACY_HISTORY_KEY, legacy);
      await store.add('A', KEY_A);
      await store.add('B', KEY_B);
      await memento.update(historyKey('id-2'), [{ timestamp: 2 }]);

      await store.removeAll();

      expect(Array.from(memento.data.keys()).filter((k) => k.startsWith(LEGACY_HISTORY_KEY))).toEqual([]);
    });
  });
});

describe('removeLegacyData', () => {
  const LEGACY = {
    'opencodeGoQuota.authCookie': 'legacy-value',
    'opencodeGoQuota.workspaceId': 'legacy-ws',
    'opencodeGoQuota.cookieTimestamp': '123',
  };

  it('deletes legacy secrets and the strategy cache and notifies once', async () => {
    const memento = createMemento({
      'opencodeGoQuota.fetcherStrategy': { strategy: 'api', timestamp: 1 },
      'opencodeGoQuota.history': [{ timestamp: 1 }],
    });
    const secrets = createSecrets(LEGACY);
    const notify = vi.fn();

    await removeLegacyData(memento, secrets, notify);

    expect(secrets.data.size).toBe(0);
    expect(memento.data.has('opencodeGoQuota.fetcherStrategy')).toBe(false);
    expect(memento.data.get('opencodeGoQuota.history')).toEqual([{ timestamp: 1 }]);
    expect(memento.data.get(MIGRATION_NOTICE_KEY)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);

    // Second activation: nothing left, nothing shown.
    await removeLegacyData(memento, secrets, notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('notifies when only one legacy secret exists', async () => {
    const notify = vi.fn();
    await removeLegacyData(createMemento(), createSecrets({ 'opencodeGoQuota.workspaceId': 'x' }), notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not notify on a clean install', async () => {
    const memento = createMemento();
    const notify = vi.fn();
    await removeLegacyData(memento, createSecrets(), notify);
    expect(notify).not.toHaveBeenCalled();
    expect(memento.data.has(MIGRATION_NOTICE_KEY)).toBe(false);
  });

  it('does not notify again if the flag is already set', async () => {
    const notify = vi.fn();
    const secrets = createSecrets(LEGACY);
    await removeLegacyData(createMemento({ [MIGRATION_NOTICE_KEY]: true }), secrets, notify);
    expect(notify).not.toHaveBeenCalled();
    expect(secrets.data.size).toBe(0);
  });
});
