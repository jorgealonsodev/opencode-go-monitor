import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerRefreshCommand, notifyAuthRejected, notifyRefreshFailed, describeError } from '../src/commands/refresh';
import { registerShowDetailsCommand } from '../src/commands/showDetails';
import { registerExportHistoryCommand } from '../src/commands/exportHistory';
import { registerOpenDashboardCommand } from '../src/commands/openDashboard';
import { HistoryStorage, historyKey } from '../src/storage/history';
import { ProfileStore } from '../src/storage/profiles';
import { createMemento, createSecrets } from './fakes';
import type { QuotaSnapshot } from '../src/domain/types';
import { AuthError, CredentialsError, NetworkError, ParseError } from '../src/domain/errors';
import type { QuickPickItem, QuickPick, CreateQuickPick } from '../src/ui/quickPick';
import type {
  DisposableLike,
  WindowLike,
  CommandsLike,
  EnvLike,
  UriLike,
} from '../src/commands/types';
import { getTranslations } from '../src/i18n';

const mockT = getTranslations('en');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createMockWindow(): WindowLike {
  return {
    showInputBox: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showSaveDialog: vi.fn(),
    showQuickPick: vi.fn(),
  };
}

function createMockCommands(): {
  commands: CommandsLike;
  invoke: (...args: any[]) => any;
  getRegisteredCommand: () => string | undefined;
} {
  let registeredCallback: ((...args: any[]) => any) | undefined;
  let registeredCommand: string | undefined;

  const commands: CommandsLike = {
    registerCommand: vi.fn((cmd: string, cb: (...args: any[]) => any) => {
      registeredCommand = cmd;
      registeredCallback = cb;
      return { dispose: vi.fn() };
    }),
    executeCommand: vi.fn(),
  };

  return {
    commands,
    invoke: (...args: any[]) => registeredCallback?.(...args),
    getRegisteredCommand: () => registeredCommand,
  };
}

function createMockEnv(): EnvLike {
  return {
    openExternal: vi.fn(),
  };
}

function createMockHistoryStorage(snapshots: QuotaSnapshot[] = []): HistoryStorage {
  return {
    append: vi.fn(),
    getAll: vi.fn(() => snapshots),
    cleanup: vi.fn(),
    exportToJson: vi.fn(() =>
      snapshots.length > 0 ? JSON.stringify({ profile: 'Personal', entries: snapshots }) : undefined,
    ),
  } as unknown as HistoryStorage;
}

function createMockQuickPick<T extends QuickPickItem>(): QuickPick<T> & {
  _fireAccept: () => void;
  _fireHide: () => void;
} {
  const listeners = {
    accept: [] as Array<() => void>,
    hide: [] as Array<() => void>,
  };

  const qp = {
    items: [] as T[],
    selectedItems: [] as readonly T[],
    onDidAccept: (listener: () => void) => {
      listeners.accept.push(listener);
      return { dispose: () => { listeners.accept = listeners.accept.filter(l => l !== listener); } };
    },
    onDidHide: (listener: () => void) => {
      listeners.hide.push(listener);
      return { dispose: () => { listeners.hide = listeners.hide.filter(l => l !== listener); } };
    },
    show: () => {},
    hide: () => { listeners.hide.forEach(l => l()); },
    dispose: () => {},
    _fireAccept: () => { listeners.accept.forEach(l => l()); },
    _fireHide: () => { listeners.hide.forEach(l => l()); },
  };

  return qp as unknown as QuickPick<T> & { _fireAccept: () => void; _fireHide: () => void };
}

function createMockFactory(): { factory: CreateQuickPick; qp: QuickPick<QuickPickItem> & { _fireAccept: () => void; _fireHide: () => void } } {
  const qp = createMockQuickPick<QuickPickItem>();
  return {
    factory: (() => qp) as unknown as CreateQuickPick,
    qp,
  };
}

function makeSnapshot(timestamp: number): QuotaSnapshot {
  return {
    timestamp,
    rolling: { status: 'ok', usagePercent: 10, resetsInSeconds: 3600 },
    weekly: { status: 'ok', usagePercent: 50, resetsInSeconds: 86400 },
    monthly: { status: 'ok', usagePercent: 30, resetsInSeconds: 2592000 },
    profileId: 'default',
  };
}

/* ------------------------------------------------------------------ */
/*  Refresh command                                                   */
/* ------------------------------------------------------------------ */

describe('registerRefreshCommand', () => {
  it('delegates to the poller', async () => {
    const { commands, invoke } = createMockCommands();
    const poller = { refresh: vi.fn(async () => undefined) };

    registerRefreshCommand(poller, commands);
    expect(commands.registerCommand).toHaveBeenCalledWith('opencodeGoQuota.refresh', expect.any(Function));

    await invoke();
    expect(poller.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('notifyAuthRejected', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('names the profile and offers Select / Replace API Key', async () => {
    const window = createMockWindow();
    const { commands } = createMockCommands();
    (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Replace API Key');

    notifyAuthRejected(new AuthError('p1', 'Team 1', 401), window, commands, mockT);
    await flush();

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "API key 'Team 1' was rejected by OpenCode (HTTP 401).",
      'Select API Key',
      'Replace API Key',
    );
    expect(commands.executeCommand).toHaveBeenCalledWith('opencodeGoQuota.replaceApiKey', 'p1');
  });

  it('is translated', () => {
    const window = createMockWindow();
    (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const es = getTranslations('es');

    notifyAuthRejected(new AuthError('p1', 'Equipo', 403), window, createMockCommands().commands, es);

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "OpenCode rechazó la clave de API 'Equipo' (HTTP 403).",
      es.actionSelectApiKey,
      es.actionReplaceApiKey,
    );
  });

  it('runs Select API Key from the notification', async () => {
    const window = createMockWindow();
    const { commands } = createMockCommands();
    (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Select API Key');

    notifyAuthRejected(new AuthError('p1', 'Team 1', 401), window, commands, mockT);
    await flush();

    expect(commands.executeCommand).toHaveBeenCalledWith('opencodeGoQuota.selectApiKey');
  });
});

describe('describeError', () => {
  const es = getTranslations('es');

  it('translates unexpected responses and timeouts', () => {
    expect(describeError(new ParseError('anything'), mockT)).toBe(mockT.errUnexpectedResponse);
    expect(describeError(new ParseError('anything'), es)).toBe(es.errUnexpectedResponse);
    expect(describeError(new NetworkError('Request timed out'), es)).toBe(es.errRequestTimedOut);
  });

  it('falls back to the error message', () => {
    expect(describeError(new NetworkError('HTTP 500', 500), mockT)).toBe('HTTP 500');
    expect(describeError('boom', mockT)).toBe('boom');
  });
});

describe('notifyRefreshFailed', () => {
  it('shows the translated failure reason', () => {
    const window = createMockWindow();
    (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    notifyRefreshFailed(new NetworkError('offline'), window, createMockCommands().commands, mockT);
    expect(window.showErrorMessage).toHaveBeenCalledWith('Failed to refresh quota: offline');
  });

  it('offers Add API Key when no key is configured', () => {
    const window = createMockWindow();
    (window.showErrorMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    notifyRefreshFailed(new CredentialsError(), window, createMockCommands().commands, mockT);
    expect(window.showErrorMessage).toHaveBeenCalledWith('No API keys saved.', 'Add API Key');
  });

  it('stays silent for auth errors (reported once per episode elsewhere)', () => {
    const window = createMockWindow();
    notifyRefreshFailed(new AuthError('p1', 'X', 401), window, createMockCommands().commands, mockT);
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  ShowDetails command                                               */
/* ------------------------------------------------------------------ */

describe('registerShowDetailsCommand', () => {
  let window: WindowLike;
  let commands: CommandsLike;
  let invoke: (...args: any[]) => any;

  beforeEach(() => {
    const mocks = createMockCommands();
    commands = mocks.commands;
    invoke = mocks.invoke;
    window = createMockWindow();
  });

  function register(
    history: HistoryStorage,
    factory: CreateQuickPick,
    options: { refresh?: () => Promise<void>; profileName?: string } = {},
  ) {
    const refresher = { refresh: vi.fn(options.refresh ?? (async () => {})) };
    registerShowDetailsCommand({
      history,
      createQuickPick: factory,
      window,
      commands,
      t: mockT,
      refresher,
      activeProfileName: () => options.profileName,
    });
    return refresher;
  }

  /** Opens the details pick and accepts the item whose action is `action`. */
  async function choose(action: string, profileName = 'Personal') {
    const { factory, qp } = createMockFactory();
    register(createMockHistoryStorage([makeSnapshot(Date.now())]), factory, { profileName });
    const promise = invoke();
    qp.selectedItems = [qp.items.find((i) => (i as { action?: string }).action === action)!];
    qp._fireAccept();
    await promise;
  }

  it('registers the correct command', () => {
    register(createMockHistoryStorage(), createMockFactory().factory);
    expect(commands.registerCommand).toHaveBeenCalledWith('opencodeGoQuota.showDetails', expect.any(Function));
  });

  it('shows the latest snapshot with Switch API key for the active profile', async () => {
    const history = createMockHistoryStorage([makeSnapshot(Date.now())]);
    const { factory, qp } = createMockFactory();
    const refresher = register(history, factory, { profileName: 'Team 1' });

    const promise = invoke();
    qp._fireHide();
    await promise;

    expect(qp.items.some((i) => i.label === '$(key) Switch API key (Team 1)')).toBe(true);
    expect(refresher.refresh).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('without history, refreshes through the poller and shows the new data', async () => {
    const snapshots: QuotaSnapshot[] = [];
    const history = createMockHistoryStorage(snapshots);
    const { factory, qp } = createMockFactory();
    const refresher = register(history, factory, {
      profileName: 'Personal',
      refresh: async () => {
        snapshots.push(makeSnapshot(Date.now()));
      },
    });

    const promise = invoke();
    await vi.waitFor(() => expect(qp.items.length).toBeGreaterThan(0));
    qp._fireHide();
    await promise;

    expect(refresher.refresh).toHaveBeenCalledTimes(1);
    expect(history.append).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('shows the no-data message when the refresh produced nothing', async () => {
    const refresher = register(createMockHistoryStorage([]), createMockFactory().factory, { profileName: 'Personal' });
    await invoke();

    expect(refresher.refresh).toHaveBeenCalledTimes(1);
    expect(window.showErrorMessage).toHaveBeenCalledWith(mockT.msgNoDataAvailable, mockT.msgRefreshNow, mockT.actionAddApiKey);
  });

  it('does not refresh without an active profile', async () => {
    const refresher = register(createMockHistoryStorage([]), createMockFactory().factory);
    await invoke();

    expect(refresher.refresh).not.toHaveBeenCalled();
    expect(window.showErrorMessage).toHaveBeenCalledWith(mockT.msgNoDataAvailable, mockT.msgRefreshNow, mockT.actionAddApiKey);
  });

  it.each([
    ['refresh', 'opencodeGoQuota.refresh'],
    ['openDashboard', 'opencodeGoQuota.openDashboard'],
    ['switchApiKey', 'opencodeGoQuota.selectApiKey'],
    ['addApiKey', 'opencodeGoQuota.configure'],
    ['removeAllApiKeys', 'opencodeGoQuota.clearCredentials'],
  ])('routes %s to %s', async (action, command) => {
    await choose(action);
    expect(commands.executeCommand).toHaveBeenCalledWith(command);
  });
});

/* ------------------------------------------------------------------ */
/*  ExportHistory command                                             */
/* ------------------------------------------------------------------ */

describe('registerExportHistoryCommand', () => {
  let history: HistoryStorage;
  let window: WindowLike;
  let { commands, invoke } = createMockCommands();

  beforeEach(() => {
    const mocks = createMockCommands();
    commands = mocks.commands;
    invoke = mocks.invoke;
    vi.clearAllMocks();
  });

  it('registers the correct command', () => {
    history = createMockHistoryStorage();
    window = createMockWindow();

    registerExportHistoryCommand(history, window, commands, mockT);
    expect(commands.registerCommand).toHaveBeenCalledWith(
      'opencodeGoQuota.exportHistory',
      expect.any(Function),
    );
  });

  it('exports history to file and shows success', async () => {
    const snapshot = makeSnapshot(Date.now());
    history = createMockHistoryStorage([snapshot]);
    window = createMockWindow();
    const uri: UriLike = { fsPath: '/tmp/history.json', toString: () => '/tmp/history.json', scheme: 'file' };
    (window.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(uri);
    const writeSpy = vi.fn();

    registerExportHistoryCommand(history, window, commands, mockT, undefined, writeSpy);
    await invoke();

    expect(window.showSaveDialog).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith(
      '/tmp/history.json',
      JSON.stringify({ profile: 'Personal', entries: [snapshot] }),
      'utf-8',
    );
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('History exported'),
    );
  });

  it('shows error when history is empty', async () => {
    history = createMockHistoryStorage([]);
    window = createMockWindow();

    registerExportHistoryCommand(history, window, commands, mockT);
    await invoke();

    expect(window.showErrorMessage).toHaveBeenCalledWith(mockT.msgNoDataAvailable);
    expect(window.showSaveDialog).not.toHaveBeenCalled();
  });

  it('exports only the active profile and never the key (FR4, AC12)', async () => {
    const KEY = 'sk-test-synthetic-key-9876';
    const memento = createMemento();
    const secrets = createSecrets();
    const ids = ['id-1', 'id-2'];
    const store = new ProfileStore(memento, secrets, () => ids.shift()!);
    await store.add('Personal', KEY);
    await store.add('Team', 'sk-test-other-key-5555');
    const realHistory = new HistoryStorage(memento, () => store.getActiveProfile());
    await realHistory.append({ ...makeSnapshot(1), profileId: 'id-1' });
    await realHistory.append({ ...makeSnapshot(2), profileId: 'id-2' });

    window = createMockWindow();
    const uri: UriLike = { fsPath: '/tmp/history.json', toString: () => '/tmp/history.json', scheme: 'file' };
    (window.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(uri);
    const writeSpy = vi.fn();

    registerExportHistoryCommand(realHistory, window, commands, mockT, undefined, writeSpy);
    await invoke();

    const written = writeSpy.mock.calls[0][1] as string;
    expect(JSON.parse(written)).toEqual({ profile: 'Personal', entries: [{ ...makeSnapshot(1), profileId: 'id-1' }] });
    for (let i = 0; i + 4 <= KEY.length; i++) {
      expect(written).not.toContain(KEY.slice(i, i + 4));
    }
  });

  it('shows the no-data message when the active profile has no entries', async () => {
    const memento = createMemento({ [historyKey('other')]: [makeSnapshot(1)] });
    const store = new ProfileStore(memento, createSecrets(), () => 'id-1');
    await store.add('Personal', 'sk-test-synthetic-key-9876');
    const realHistory = new HistoryStorage(memento, () => store.getActiveProfile());
    window = createMockWindow();

    registerExportHistoryCommand(realHistory, window, commands, mockT);
    await invoke();

    expect(window.showErrorMessage).toHaveBeenCalledWith(mockT.msgNoDataAvailable);
    expect(window.showSaveDialog).not.toHaveBeenCalled();
  });

  it('does nothing when user cancels save dialog', async () => {
    const snapshot = makeSnapshot(Date.now());
    history = createMockHistoryStorage([snapshot]);
    window = createMockWindow();
    (window.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const writeSpy = vi.fn();

    registerExportHistoryCommand(history, window, commands, mockT, undefined, writeSpy);
    await invoke();

    expect(writeSpy).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('shows error when write fails', async () => {
    const snapshot = makeSnapshot(Date.now());
    history = createMockHistoryStorage([snapshot]);
    window = createMockWindow();
    const uri: UriLike = { fsPath: '/tmp/history.json', toString: () => '/tmp/history.json', scheme: 'file' };
    (window.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(uri);
    const writeSpy = vi.fn(() => {
      throw new Error('disk full');
    });

    registerExportHistoryCommand(history, window, commands, mockT, undefined, writeSpy);
    await invoke();

    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });
});

/* ------------------------------------------------------------------ */
/*  OpenDashboard command                                             */
/* ------------------------------------------------------------------ */

describe('registerOpenDashboardCommand', () => {
  let env: EnvLike;
  let { commands, invoke } = createMockCommands();

  beforeEach(() => {
    const mocks = createMockCommands();
    commands = mocks.commands;
    invoke = mocks.invoke;
  });

  it('registers the correct command', () => {
    env = createMockEnv();
    registerOpenDashboardCommand(env, commands);
    expect(commands.registerCommand).toHaveBeenCalledWith(
      'opencodeGoQuota.openDashboard',
      expect.any(Function),
    );
  });

  it('opens the correct URL', async () => {
    env = createMockEnv();
    registerOpenDashboardCommand(env, commands);
    await invoke();

    expect(env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        toString: expect.any(Function),
      }),
    );
    const callArg = (env.openExternal as ReturnType<typeof vi.fn>).mock.calls[0][0] as UriLike;
    expect(callArg.toString()).toBe('https://opencode.ai/console');
  });
});
