import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerRefreshCommand, notifyAuthRejected, notifyRefreshFailed } from '../src/commands/refresh';
import { registerShowDetailsCommand } from '../src/commands/showDetails';
import { registerExportHistoryCommand } from '../src/commands/exportHistory';
import { registerOpenDashboardCommand } from '../src/commands/openDashboard';
import type { HistoryStorage } from '../src/storage/history';
import type { StatusBarManager } from '../src/ui/statusBar';
import type { QuotaFetcher, QuotaSnapshot } from '../src/domain/types';
import { AuthError, CredentialsError, NetworkError } from '../src/domain/errors';
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
    getLast24h: vi.fn(() => snapshots),
    cleanup: vi.fn(),
    exportToJson: vi.fn(() => JSON.stringify(snapshots)),
    getCachedStrategy: vi.fn(),
    setCachedStrategy: vi.fn(),
    clearCachedStrategy: vi.fn(),
  } as unknown as HistoryStorage;
}

function createMockFetcher(snapshot?: QuotaSnapshot): QuotaFetcher {
  return {
    fetch: vi.fn(async () => {
      if (!snapshot) throw new Error('fetch failed');
      return snapshot;
    }),
    isAvailable: vi.fn(async () => true),
  };
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
      mockT.actionAddApiKey,
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
