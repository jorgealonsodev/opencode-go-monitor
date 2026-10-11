import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerApiKeyCommands, type ApiKeyCommandDeps } from '../src/commands/apiKeys';
import { ProfileStore, apiKeySecretKey } from '../src/storage/profiles';
import { historyKey } from '../src/storage/history';
import { AuthError, NetworkError } from '../src/domain/errors';
import type { ActiveKey, ActiveKeyProvider, QuotaFetcher, QuotaSnapshot } from '../src/domain/types';
import type { CommandsLike, WindowLike } from '../src/commands/types';
import { getTranslations } from '../src/i18n';
import { createMemento, createSecrets } from './fakes';

const t = getTranslations('en');

const KEY_A = 'sk-test-aaaaaaaaaaaa1111';
const KEY_B = 'sk-test-bbbbbbbbbbbb2222';

function snapshot(profileId: string): QuotaSnapshot {
  return {
    timestamp: 1,
    profileId,
    rolling: { status: 'ok', usagePercent: 42, resetsInSeconds: 60 },
    weekly: { status: 'ok', usagePercent: 10, resetsInSeconds: 60 },
    monthly: { status: 'ok', usagePercent: 5, resetsInSeconds: 60 },
  };
}

type Mocked<T> = { [K in keyof T]: T[K] & ReturnType<typeof vi.fn> };

function createWindow(): Mocked<WindowLike> {
  return {
    showInputBox: vi.fn(),
    showInformationMessage: vi.fn(async () => undefined),
    showWarningMessage: vi.fn(async () => undefined),
    showErrorMessage: vi.fn(async () => undefined),
    showSaveDialog: vi.fn(),
    showQuickPick: vi.fn(),
  } as unknown as Mocked<WindowLike>;
}

function createCommands() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const commands: CommandsLike = {
    registerCommand: vi.fn((id: string, cb: (...args: any[]) => any) => {
      handlers.set(id, cb);
      return { dispose: vi.fn() };
    }),
    executeCommand: vi.fn(async () => undefined),
  };
  const run = (id: string, ...args: any[]) => {
    const handler = handlers.get(id);
    if (!handler) {
      throw new Error(`command not registered: ${id}`);
    }
    return handler(...args);
  };
  return { commands, handlers, run };
}

/** Lets fire-and-forget `.then` chains settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('API key commands', () => {
  let memento: ReturnType<typeof createMemento>;
  let secrets: ReturnType<typeof createSecrets>;
  let store: ProfileStore;
  let window: Mocked<WindowLike>;
  let cmds: ReturnType<typeof createCommands>;
  let fetchResult: (active: ActiveKey) => Promise<QuotaSnapshot>;
  let seenKeys: ActiveKey[];
  let onActiveProfileChanged: ReturnType<typeof vi.fn>;
  let nextId: number;

  beforeEach(() => {
    memento = createMemento();
    secrets = createSecrets();
    nextId = 1;
    store = new ProfileStore(memento, secrets, () => `id-${nextId++}`);
    window = createWindow();
    cmds = createCommands();
    seenKeys = [];
    fetchResult = async (active) => snapshot(active.id);
    onActiveProfileChanged = vi.fn(async () => undefined);

    const deps: ApiKeyCommandDeps = {
      store,
      window,
      commands: cmds.commands,
      t,
      createFetcher: (keys: ActiveKeyProvider): QuotaFetcher => ({
        fetch: async () => {
          const active = (await keys.getActive())!;
          seenKeys.push(active);
          return fetchResult(active);
        },
        isAvailable: async () => true,
      }),
      onActiveProfileChanged,
    };
    registerApiKeyCommands(deps);
  });

  function inputs(...values: Array<string | undefined>) {
    for (const v of values) {
      window.showInputBox.mockResolvedValueOnce(v);
    }
  }

  it('registers every profile command, reusing the legacy ids', () => {
    expect([...cmds.handlers.keys()].sort()).toEqual(
      [
        'opencodeGoQuota.clearCredentials',
        'opencodeGoQuota.configure',
        'opencodeGoQuota.removeApiKey',
        'opencodeGoQuota.renameApiKey',
        'opencodeGoQuota.replaceApiKey',
        'opencodeGoQuota.selectApiKey',
      ].sort(),
    );
  });

  describe('Add API Key', () => {
    it('validates, saves, activates the first key and reuses the response as first snapshot', async () => {
      inputs('Personal', KEY_A);
      await cmds.run('opencodeGoQuota.configure');

      expect(seenKeys).toHaveLength(1);
      expect(seenKeys[0].key).toBe(KEY_A);
      expect(store.list()).toEqual([expect.objectContaining({ id: 'id-1', name: 'Personal' })]);
      expect(secrets.data.get(apiKeySecretKey('id-1'))).toBe(KEY_A);
      expect(store.getActiveProfile()?.id).toBe('id-1');
      expect(onActiveProfileChanged).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'id-1' }));
    });

    it('uses a password input for the key and validates name input', async () => {
      await store.add('Team', KEY_B);
      inputs('Personal', KEY_A);
      await cmds.run('opencodeGoQuota.configure');

      const nameOptions = window.showInputBox.mock.calls[0][0];
      expect(nameOptions.validateInput('team')).toBe("A key named 'team' already exists");
      expect(nameOptions.validateInput('   ')).toBe('Name is required');
      expect(nameOptions.validateInput('a'.repeat(41))).toBe('Use 40 characters or fewer');
      expect(nameOptions.validateInput('a(b)')).toBe("Names can't contain [ ] ( ) or control characters");
      expect(nameOptions.validateInput('Fine')).toBeUndefined();

      const keyOptions = window.showInputBox.mock.calls[1][0];
      expect(keyOptions.password).toBe(true);
      expect(keyOptions.validateInput('has space')).toBe("This doesn't look like an API key");
      expect(keyOptions.validateInput(KEY_A)).toBeUndefined();
    });

    it('offers "Monitor <name>" for later keys without activating them', async () => {
      await store.add('Personal', KEY_A);
      window.showInformationMessage.mockResolvedValueOnce('Monitor Team 1');
      inputs('Team 1', KEY_B);

      await cmds.run('opencodeGoQuota.configure');
      expect(window.showInformationMessage).toHaveBeenCalledWith("Saved 'Team 1'.", 'Monitor Team 1');
      await flush();

      expect(store.getActiveProfile()?.id).toBe('id-2');
      expect(onActiveProfileChanged).toHaveBeenCalledTimes(1);
    });

    it('keeps the current profile when "Monitor" is dismissed', async () => {
      await store.add('Personal', KEY_A);
      inputs('Team 1', KEY_B);
      await cmds.run('opencodeGoQuota.configure');
      await flush();

      expect(store.list()).toHaveLength(2);
      expect(store.getActiveProfile()?.id).toBe('id-1');
      expect(onActiveProfileChanged).not.toHaveBeenCalled();
    });

    it('on 401 lets the user try again with another key', async () => {
      fetchResult = async (active) => {
        if (active.key === KEY_A) throw new AuthError(active.id, active.name, 401);
        return snapshot(active.id);
      };
      window.showErrorMessage.mockResolvedValueOnce('Try again');
      inputs('Personal', KEY_A, KEY_B);

      await cmds.run('opencodeGoQuota.configure');

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'The key was rejected by OpenCode.',
        'Try again',
        'Save anyway',
        'Cancel',
      );
      expect(secrets.data.get(apiKeySecretKey('id-1'))).toBe(KEY_B);
    });

    it('on 401 can save anyway without a first snapshot', async () => {
      fetchResult = async (active) => {
        throw new AuthError(active.id, active.name, 403);
      };
      window.showErrorMessage.mockResolvedValueOnce('Save anyway');
      inputs('Personal', KEY_A);

      await cmds.run('opencodeGoQuota.configure');

      expect(store.list()).toHaveLength(1);
      expect(onActiveProfileChanged).toHaveBeenCalledWith(undefined);
    });

    it('on network error offers save anyway with the reason', async () => {
      fetchResult = async () => {
        throw new NetworkError('Request timed out');
      };
      window.showErrorMessage.mockResolvedValueOnce('Save anyway');
      inputs('Personal', KEY_A);

      await cmds.run('opencodeGoQuota.configure');

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        "Couldn't verify the key (Request timed out).",
        'Save anyway',
        'Cancel',
      );
      expect(store.list()).toHaveLength(1);
    });

    it('cancelling after a failed validation saves nothing', async () => {
      fetchResult = async () => {
        throw new NetworkError('HTTP 500', 500);
      };
      window.showErrorMessage.mockResolvedValueOnce('Cancel');
      inputs('Personal', KEY_A);

      await cmds.run('opencodeGoQuota.configure');

      expect(store.list()).toEqual([]);
      expect(secrets.data.size).toBe(0);
    });

    it('escape at the name or key step cancels silently', async () => {
      inputs(undefined);
      await cmds.run('opencodeGoQuota.configure');
      inputs('Personal', undefined);
      await cmds.run('opencodeGoQuota.configure');

      expect(seenKeys).toEqual([]);
      expect(store.list()).toEqual([]);
      expect(window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe('Select API Key', () => {
    it('opens Add API Key when there are no profiles', async () => {
      await cmds.run('opencodeGoQuota.selectApiKey');
      expect(cmds.commands.executeCommand).toHaveBeenCalledWith('opencodeGoQuota.configure');
    });

    it('marks the active profile, shows the last 4 characters, activates and refreshes', async () => {
      await store.add('Personal', KEY_A);
      await store.add('Team', KEY_B);
      window.showQuickPick.mockImplementationOnce(async (items: any[]) => items[1]);

      await cmds.run('opencodeGoQuota.selectApiKey');

      const items = window.showQuickPick.mock.calls[0][0];
      expect(items.map((i: any) => [i.label, i.description])).toEqual([
        ['$(check) Personal', '…1111'],
        ['Team', '…2222'],
      ]);
      expect(store.getActiveProfile()?.id).toBe('id-2');
      expect(onActiveProfileChanged).toHaveBeenCalledWith();
    });

    it('does nothing when the pick is dismissed', async () => {
      await store.add('Personal', KEY_A);
      await cmds.run('opencodeGoQuota.selectApiKey');
      expect(onActiveProfileChanged).not.toHaveBeenCalled();
    });
  });

  describe('Rename API Key', () => {
    it('renames the picked profile keeping its secret', async () => {
      await store.add('Personal', KEY_A);
      window.showQuickPick.mockImplementationOnce(async (items: any[]) => items[0]);
      inputs('Work');

      await cmds.run('opencodeGoQuota.renameApiKey');

      expect(window.showInputBox.mock.calls[0][0].value).toBe('Personal');
      expect(window.showInputBox.mock.calls[0][0].validateInput('personal')).toBeUndefined();
      expect(store.list()[0]).toMatchObject({ id: 'id-1', name: 'Work' });
      expect(secrets.data.get(apiKeySecretKey('id-1'))).toBe(KEY_A);
      expect(onActiveProfileChanged).not.toHaveBeenCalled();
    });

    it('tells the user when there are no keys', async () => {
      await cmds.run('opencodeGoQuota.renameApiKey');
      expect(window.showInformationMessage).toHaveBeenCalledWith('No API keys saved.', 'Add API Key');
    });
  });

  describe('Replace API Key', () => {
    it('keeps id and name and refreshes with the validation snapshot when active', async () => {
      await store.add('Personal', KEY_A);
      window.showQuickPick.mockImplementationOnce(async (items: any[]) => items[0]);
      inputs(KEY_B);

      await cmds.run('opencodeGoQuota.replaceApiKey');

      expect(seenKeys[0]).toEqual({ id: 'id-1', name: 'Personal', key: KEY_B });
      expect(store.list()).toEqual([expect.objectContaining({ id: 'id-1', name: 'Personal' })]);
      expect(await store.getActive()).toEqual({ id: 'id-1', name: 'Personal', key: KEY_B });
      expect(onActiveProfileChanged).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'id-1' }));
    });

    it('targets a profile id passed as argument without asking', async () => {
      await store.add('Personal', KEY_A);
      await store.add('Team', KEY_A);
      inputs(KEY_B);

      await cmds.run('opencodeGoQuota.replaceApiKey', 'id-2');

      expect(window.showQuickPick).not.toHaveBeenCalled();
      expect(secrets.data.get(apiKeySecretKey('id-2'))).toBe(KEY_B);
      expect(onActiveProfileChanged).not.toHaveBeenCalled();
    });
  });

  describe('Remove API Key', () => {
    it('asks for confirmation and does nothing when cancelled', async () => {
      await store.add('Personal', KEY_A);
      window.showQuickPick.mockImplementationOnce(async (items: any[]) => items[0]);

      await cmds.run('opencodeGoQuota.removeApiKey');

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        "Remove 'Personal' and its stored history? This can't be undone.",
        { modal: true },
        'Remove',
      );
      expect(store.list()).toHaveLength(1);
    });

    it('removing the active profile switches to the next and says so', async () => {
      await store.add('Personal', KEY_A);
      await store.add('Team', KEY_B);
      await memento.update(historyKey('id-1'), [snapshot('id-1')]);
      await memento.update(historyKey('id-2'), [snapshot('id-2')]);
      window.showQuickPick.mockImplementationOnce(async (items: any[]) => items[0]);
      window.showWarningMessage.mockResolvedValueOnce('Remove');

      await cmds.run('opencodeGoQuota.removeApiKey');

      expect(store.list().map((p) => p.name)).toEqual(['Team']);
      expect(secrets.data.has(apiKeySecretKey('id-1'))).toBe(false);
      expect(memento.data.has(historyKey('id-1'))).toBe(false);
      expect(memento.data.get(historyKey('id-2'))).toEqual([snapshot('id-2')]);
      expect(window.showInformationMessage).toHaveBeenCalledWith("Removed 'Personal'. Now monitoring 'Team'.");
      expect(onActiveProfileChanged).toHaveBeenCalledTimes(1);
    });

    it('removing the last profile goes back to setup', async () => {
      await store.add('Personal', KEY_A);
      window.showQuickPick.mockImplementationOnce(async (items: any[]) => items[0]);
      window.showWarningMessage.mockResolvedValueOnce('Remove');

      await cmds.run('opencodeGoQuota.removeApiKey');

      expect(store.list()).toEqual([]);
      expect(store.getActiveProfile()).toBeUndefined();
      expect(onActiveProfileChanged).toHaveBeenCalledTimes(1);
    });

    it('removing a non-active profile keeps monitoring the active one', async () => {
      await store.add('Personal', KEY_A);
      await store.add('Team', KEY_B);
      window.showQuickPick.mockImplementationOnce(async (items: any[]) => items[1]);
      window.showWarningMessage.mockResolvedValueOnce('Remove');

      await cmds.run('opencodeGoQuota.removeApiKey');

      expect(store.getActiveProfile()?.id).toBe('id-1');
      expect(window.showInformationMessage).toHaveBeenCalledWith("Removed 'Team'.");
      expect(onActiveProfileChanged).not.toHaveBeenCalled();
    });
  });

  describe('Remove All API Keys', () => {
    it('does nothing with zero profiles', async () => {
      await cmds.run('opencodeGoQuota.clearCredentials');
      expect(window.showWarningMessage).not.toHaveBeenCalled();
      expect(onActiveProfileChanged).not.toHaveBeenCalled();
    });

    it('confirms with the count and removes everything', async () => {
      await store.add('Personal', KEY_A);
      await store.add('Team', KEY_B);
      await memento.update(historyKey('id-1'), [snapshot('id-1')]);
      await memento.update(historyKey('id-2'), [snapshot('id-2')]);
      window.showWarningMessage.mockResolvedValueOnce('Remove all');

      await cmds.run('opencodeGoQuota.clearCredentials');

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        'Remove all 2 API keys and their history?',
        { modal: true },
        'Remove all',
      );
      expect(store.list()).toEqual([]);
      expect(secrets.data.size).toBe(0);
      expect(memento.data.has(historyKey('id-1'))).toBe(false);
      expect(memento.data.has(historyKey('id-2'))).toBe(false);
      expect(onActiveProfileChanged).toHaveBeenCalledTimes(1);
    });

    it('keeps everything when cancelled', async () => {
      await store.add('Personal', KEY_A);
      await cmds.run('opencodeGoQuota.clearCredentials');
      expect(store.list()).toHaveLength(1);
    });
  });

  it('never shows the key in any message', async () => {
    fetchResult = async (active) => {
      throw new AuthError(active.id, active.name, 401);
    };
    window.showErrorMessage.mockResolvedValueOnce('Save anyway');
    inputs('Personal', KEY_A);
    await cmds.run('opencodeGoQuota.configure');

    const messages = JSON.stringify([
      window.showErrorMessage.mock.calls,
      window.showInformationMessage.mock.calls,
      window.showWarningMessage.mock.calls,
    ]);
    expect(messages).not.toContain(KEY_A.slice(0, 8));
  });
});
