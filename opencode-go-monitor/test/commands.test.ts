import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerConfigureCommand } from '../src/commands/configure';
import { registerRefreshCommand } from '../src/commands/refresh';
import { registerShowDetailsCommand } from '../src/commands/showDetails';
import { registerExportHistoryCommand } from '../src/commands/exportHistory';
import { registerOpenDashboardCommand } from '../src/commands/openDashboard';
import { registerClearCredentialsCommand } from '../src/commands/clearCredentials';
import type { CredentialsStorage } from '../src/storage/credentials';
import type { HistoryStorage } from '../src/storage/history';
import type { FetcherSelector } from '../src/fetchers/FetcherSelector';
import type { StatusBarManager } from '../src/ui/statusBar';
import type { QuotaSnapshot } from '../src/domain/types';
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
    showErrorMessage: vi.fn(),
    showSaveDialog: vi.fn(),
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

function createMockCredentialsStorage(): CredentialsStorage {
  return {
    saveCredentials: vi.fn(),
    getCredentials: vi.fn(),
    clearCredentials: vi.fn(),
    hasCredentials: vi.fn(),
    maskCookie: vi.fn((c: string) => c),
  } as unknown as CredentialsStorage;
}

function createMockHistoryStorage(snapshots: QuotaSnapshot[] = []): HistoryStorage {
  return {
    append: vi.fn(),
    getAll: vi.fn(() => snapshots),
    getLast24h: vi.fn(() => snapshots),
    cleanup: vi.fn(),
    exportToJson: vi.fn(() => JSON.stringify(snapshots)),
    getCachedStrategy: vi.fn(),
    setCachedStrategy: vi.fn(),
    clearCachedStrategy: vi.fn(),
  } as unknown as HistoryStorage;
}

function createMockFetcherSelector(snapshot?: QuotaSnapshot): FetcherSelector {
  return {
    fetch: vi.fn(async () => {
      if (!snapshot) throw new Error('fetch failed');
      return snapshot;
    }),
    isAvailable: vi.fn(async () => true),
    getBackoffDelay: vi.fn(() => 0),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  } as unknown as FetcherSelector;
}

function createMockStatusBarManager(): StatusBarManager {
  return {
    create: vi.fn(),
    update: vi.fn(),
    setState: vi.fn(),
    dispose: vi.fn(),
    item: undefined,
  } as unknown as StatusBarManager;
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
    source: 'api',
  };
}

/* ------------------------------------------------------------------ */
/*  Configure command                                                 */
/* ------------------------------------------------------------------ */

describe('registerConfigureCommand', () => {
  let credentials: CredentialsStorage;
  let window: WindowLike;
  let { commands, invoke, getRegisteredCommand } = createMockCommands();

  beforeEach(() => {
    credentials = createMockCredentialsStorage();
    window = createMockWindow();
    const mocks = createMockCommands();
    commands = mocks.commands;
    invoke = mocks.invoke;
    getRegisteredCommand = mocks.getRegisteredCommand;
  });

  it('registers the correct command', () => {
    registerConfigureCommand(credentials, window, commands, mockT);
    expect(getRegisteredCommand()).toBe('opencodeGoQuota.configure');
  });

  it('saves credentials when both inputs are provided', async () => {
    registerConfigureCommand(credentials, window, commands, mockT);
    (window.showInputBox as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('ws-123')
      .mockResolvedValueOnce('cookie-abc');

    await invoke();

    expect(credentials.saveCredentials).toHaveBeenCalledWith('cookie-abc', 'ws-123');
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('OpenCode Go credentials saved'),
    );
  });

  it('shows error when workspaceId is empty', async () => {
    registerConfigureCommand(credentials, window, commands, mockT);
    (window.showInputBox as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('   ')
      .mockResolvedValueOnce('cookie-abc');

    await invoke();

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Both workspace ID and auth cookie are required.',
    );
    expect(credentials.saveCredentials).not.toHaveBeenCalled();
  });

  it('shows error when authCookie is empty', async () => {
    registerConfigureCommand(credentials, window, commands, mockT);
    (window.showInputBox as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('ws-123')
      .mockResolvedValueOnce('   ');

    await invoke();

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Both workspace ID and auth cookie are required.',
    );
    expect(credentials.saveCredentials).not.toHaveBeenCalled();
  });

  it('does nothing when user cancels workspaceId prompt', async () => {
    registerConfigureCommand(credentials, window, commands, mockT);
    (window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await invoke();

    expect(credentials.saveCredentials).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('does nothing when user cancels authCookie prompt', async () => {
    registerConfigureCommand(credentials, window, commands, mockT);
    (window.showInputBox as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('ws-123')
      .mockResolvedValueOnce(undefined);

    await invoke();

    expect(credentials.saveCredentials).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('shows error notification on unexpected error', async () => {
    registerConfigureCommand(credentials, window, commands, mockT);
    (window.showInputBox as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    await invoke();

    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

/* ------------------------------------------------------------------ */
/*  Refresh command                                                   */
/* ------------------------------------------------------------------ */

describe('registerRefreshCommand', () => {
  let fetcher: FetcherSelector;
  let history: HistoryStorage;
  let statusBar: StatusBarManager;
  let window: WindowLike;
  let { commands, invoke } = createMockCommands();

  beforeEach(() => {
    const mocks = createMockCommands();
    commands = mocks.commands;
    invoke = mocks.invoke;
  });

  it('registers the correct command', () => {
    fetcher = createMockFetcherSelector();
    history = createMockHistoryStorage();
    statusBar = createMockStatusBarManager();
    window = createMockWindow();

    registerRefreshCommand(fetcher, history, statusBar, window, commands);
    expect(commands.registerCommand).toHaveBeenCalledWith(
      'opencodeGoQuota.refresh',
      expect.any(Function),
    );
  });

  it('fetches, appends to history, updates status bar, and shows success', async () => {
    const snapshot = makeSnapshot(Date.now());
    fetcher = createMockFetcherSelector(snapshot);
    history = createMockHistoryStorage();
    statusBar = createMockStatusBarManager();
    window = createMockWindow();

    registerRefreshCommand(fetcher, history, statusBar, window, commands, { warning: 80, error: 95 }, 'rolling');
    await invoke();

    expect(statusBar.setState).toHaveBeenCalledWith('loading');
    expect(fetcher.fetch).toHaveBeenCalled();
    expect(history.append).toHaveBeenCalledWith(snapshot);
    expect(statusBar.update).toHaveBeenCalledWith(snapshot, { warning: 80, error: 95 }, 'rolling');
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Quota refreshed'),
    );
  });

  it('sets error state and shows notification on failure', async () => {
    fetcher = createMockFetcherSelector(undefined);
    history = createMockHistoryStorage();
    statusBar = createMockStatusBarManager();
    window = createMockWindow();

    registerRefreshCommand(fetcher, history, statusBar, window, commands, { warning: 80, error: 95 }, 'rolling');
    await invoke();

    expect(statusBar.setState).toHaveBeenCalledWith('loading');
    expect(statusBar.setState).toHaveBeenCalledWith('error');
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to refresh quota'),
    );
  });

  it('uses custom thresholds when provided', async () => {
    const snapshot = makeSnapshot(Date.now());
    fetcher = createMockFetcherSelector(snapshot);
    history = createMockHistoryStorage();
    statusBar = createMockStatusBarManager();
    window = createMockWindow();

    registerRefreshCommand(fetcher, history, statusBar, window, commands, {
      warning: 70,
      error: 90,
    }, 'rolling');
    await invoke();

    expect(statusBar.update).toHaveBeenCalledWith(snapshot, { warning: 70, error: 90 }, 'rolling');
  });
});

/* ------------------------------------------------------------------ */
/*  ShowDetails command                                               */
/* ------------------------------------------------------------------ */

describe('registerShowDetailsCommand', () => {
  let history: HistoryStorage;
  let statusBar: StatusBarManager;
  let window: WindowLike;
  let { commands, invoke } = createMockCommands();

  beforeEach(() => {
    const mocks = createMockCommands();
    commands = mocks.commands;
    invoke = mocks.invoke;
  });

  it('registers the correct command', () => {
    history = createMockHistoryStorage();
    statusBar = createMockStatusBarManager();
    window = createMockWindow();
    const { factory } = createMockFactory();

    registerShowDetailsCommand(history, statusBar, factory, window, commands);
    expect(commands.registerCommand).toHaveBeenCalledWith(
      'opencodeGoQuota.showDetails',
      expect.any(Function),
    );
  });

  it('shows quick pick with latest snapshot when history exists', async () => {
    const snapshot = makeSnapshot(Date.now());
    history = createMockHistoryStorage([snapshot]);
    statusBar = createMockStatusBarManager();
    window = createMockWindow();
    const { factory, qp } = createMockFactory();

    registerShowDetailsCommand(history, statusBar, factory, window, commands);
    const promise = invoke();
    qp._fireHide();
    await promise;

    expect(history.getAll).toHaveBeenCalled();
    expect(qp.items.length).toBeGreaterThan(0);
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('shows error when history is empty', async () => {
    history = createMockHistoryStorage([]);
    statusBar = createMockStatusBarManager();
    window = createMockWindow();
    const { factory } = createMockFactory();

    registerShowDetailsCommand(history, statusBar, factory, window, commands);
    await invoke();

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      mockT.msgNoDataAvailable,
      mockT.msgRefreshNow,
      mockT.msgConfigureCredentials,
    );
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

    registerExportHistoryCommand(history, window, commands);
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
    expect(writeSpy).toHaveBeenCalledWith('/tmp/history.json', JSON.stringify([snapshot]), 'utf-8');
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
    registerOpenDashboardCommand('ws-123', env, commands);
    expect(commands.registerCommand).toHaveBeenCalledWith(
      'opencodeGoQuota.openDashboard',
      expect.any(Function),
    );
  });

  it('opens the correct URL', async () => {
    env = createMockEnv();
    registerOpenDashboardCommand('ws-123', env, commands);
    await invoke();

    expect(env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        toString: expect.any(Function),
      }),
    );
    const callArg = (env.openExternal as ReturnType<typeof vi.fn>).mock.calls[0][0] as UriLike;
    expect(callArg.toString()).toBe('https://opencode.ai/workspace/ws-123/go');
  });
});

/* ------------------------------------------------------------------ */
/*  ClearCredentials command                                          */
/* ------------------------------------------------------------------ */

describe('registerClearCredentialsCommand', () => {
  let credentials: CredentialsStorage;
  let statusBar: StatusBarManager;
  let window: WindowLike;
  let { commands, invoke } = createMockCommands();

  beforeEach(() => {
    credentials = createMockCredentialsStorage();
    statusBar = createMockStatusBarManager();
    window = createMockWindow();
    const mocks = createMockCommands();
    commands = mocks.commands;
    invoke = mocks.invoke;
  });

  it('registers the correct command', () => {
    registerClearCredentialsCommand(credentials, statusBar, window, commands);
    expect(commands.registerCommand).toHaveBeenCalledWith(
      'opencodeGoQuota.clearCredentials',
      expect.any(Function),
    );
  });

  it('clears credentials, resets status bar, and shows confirmation', async () => {
    registerClearCredentialsCommand(credentials, statusBar, window, commands, mockT);
    await invoke();

    expect(credentials.clearCredentials).toHaveBeenCalled();
    expect(statusBar.setState).toHaveBeenCalledWith('setup');
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'OpenCode Go credentials cleared.',
    );
  });

  it('shows error on unexpected failure', async () => {
    (credentials.clearCredentials as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('storage locked'),
    );

    registerClearCredentialsCommand(credentials, statusBar, window, commands, mockT);
    await invoke();

    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('storage locked'));
  });
});
