import * as vscode from 'vscode';
import { CredentialsStorage, HistoryStorage } from './storage';
import { ScrapingFetcher, ApiFetcher, FetcherSelector } from './fetchers';
import { StatusBarManager } from './ui';
import {
  registerConfigureCommand,
  registerRefreshCommand,
  registerShowDetailsCommand,
  registerExportHistoryCommand,
  registerOpenDashboardCommand,
  registerClearCredentialsCommand,
} from './commands';
import { CredentialsError } from './domain/errors';
import type { QuotaSnapshot } from './domain/types';
import type { QuickPick, QuickPickItem } from './ui/quickPick';

let pollingTimer: NodeJS.Timeout | undefined;
let disposables: vscode.Disposable[] = [];
let lastFetchTime = 0;

const POLL_BACKOFF_DELAYS_MS = [60_000, 300_000, 900_000, 1_800_000];

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('opencodeGoQuota');
}

function readPollInterval(): number {
  const config = getConfig();
  const value = config.get<number>('pollIntervalSeconds', 300);
  return Math.max(60, value);
}

function createQuickPickAdapter<T extends QuickPickItem>(): QuickPick<T> {
  const qp = vscode.window.createQuickPick();
  return {
    get items() {
      return qp.items as T[];
    },
    set items(value) {
      qp.items = value;
    },
    get selectedItems() {
      return qp.selectedItems as readonly T[];
    },
    onDidAccept: (listener: () => void) => qp.onDidAccept(listener) as unknown as { dispose: () => void },
    onDidHide: (listener: () => void) => qp.onDidHide(listener) as unknown as { dispose: () => void },
    show: () => qp.show(),
    hide: () => qp.hide(),
    dispose: () => qp.dispose(),
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<vscode.Disposable> {
  // 1. Initialize storage
  const credentialsStorage = new CredentialsStorage(
    context.secrets,
    vscode.workspace.getConfiguration('opencodeGoQuota')
  );
  const historyStorage = new HistoryStorage(context.globalState);
  await historyStorage.cleanup();

  // 2. Initialize fetchers
  const scrapingFetcher = new ScrapingFetcher(credentialsStorage);
  const apiFetcher = new ApiFetcher(credentialsStorage);
  const fetcherSelector = new FetcherSelector(apiFetcher, scrapingFetcher, historyStorage);

  // 3. Initialize UI
  const statusBarManager = new StatusBarManager((alignment: number, priority: number) =>
    vscode.window.createStatusBarItem(alignment as vscode.StatusBarAlignment, priority) as any
  );
  statusBarManager.create();

  // 4. Set initial state based on credentials
  const hasCreds = await credentialsStorage.hasCredentials();
  if (!hasCreds) {
    statusBarManager.setState('setup');
  } else {
    statusBarManager.setState('loading');
  }

  // 5. Read thresholds from config
  const config = getConfig();
  const thresholds = {
    warning: config.get<number>('warningThreshold', 80),
    error: config.get<number>('errorThreshold', 95),
  };

  // Polling state
  let isFetching = false;
  let pollFailureCount = 0;
  let lastPollFailureTime = 0;
  let currentIntervalMs = readPollInterval() * 1000;

  function getPollBackoffMs(): number {
    if (pollFailureCount === 0) {
      return 0;
    }
    const stage = Math.min(pollFailureCount - 1, POLL_BACKOFF_DELAYS_MS.length - 1);
    const delay = POLL_BACKOFF_DELAYS_MS[stage];
    const elapsed = Date.now() - lastPollFailureTime;
    return Math.max(0, delay - elapsed);
  }

  async function doFetch(): Promise<void> {
    const backoffMs = getPollBackoffMs();
    if (backoffMs > 0) {
      return;
    }

    if (isFetching) {
      return;
    }

    isFetching = true;
    try {
      const snapshot = await fetcherSelector.fetch();
      await historyStorage.append(snapshot);
      statusBarManager.update(snapshot, thresholds);
      lastFetchTime = Date.now();
      pollFailureCount = 0;
      lastPollFailureTime = 0;
    } catch (err) {
      pollFailureCount++;
      lastPollFailureTime = Date.now();
      if (err instanceof CredentialsError) {
        statusBarManager.setState('auth');
      } else {
        statusBarManager.setState('error');
      }
    } finally {
      isFetching = false;
    }
  }

  function scheduleNext(): void {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = undefined;
    }
    currentIntervalMs = readPollInterval() * 1000;
    pollingTimer = setInterval(() => {
      doFetch().catch(() => {
        /* errors are handled inside doFetch */
      });
    }, currentIntervalMs);
  }

  // Initial fetch if credentials are present
  if (hasCreds) {
    doFetch().catch(() => {
      /* errors are handled inside doFetch */
    });
  }

  scheduleNext();

  // 6. Register commands
  const registered: vscode.Disposable[] = [];

  registered.push(
    registerConfigureCommand(credentialsStorage, vscode.window, vscode.commands)
  );

  registered.push(
    registerRefreshCommand(
      fetcherSelector,
      historyStorage,
      statusBarManager,
      vscode.window,
      vscode.commands,
      thresholds
    )
  );

  registered.push(
    registerShowDetailsCommand(
      historyStorage,
      statusBarManager,
      createQuickPickAdapter,
      vscode.window,
      vscode.commands
    )
  );

  registered.push(
    registerExportHistoryCommand(historyStorage, vscode.window, vscode.commands)
  );

  const creds = await credentialsStorage.getCredentials();
  registered.push(
    registerOpenDashboardCommand(
      creds?.workspaceId ?? '',
      vscode.env,
      vscode.commands,
      {
        parse: (uri: string) =>
          ({ fsPath: uri, toString: () => uri, scheme: 'https' }) as import('./commands/types').UriLike,
      }
    )
  );

  registered.push(
    registerClearCredentialsCommand(credentialsStorage, statusBarManager, vscode.window, vscode.commands)
  );

  // 7. Sleep/resume detection
  const windowStateDisposable = vscode.window.onDidChangeWindowState((state) => {
    if (state.focused && lastFetchTime > 0) {
      const elapsed = Date.now() - lastFetchTime;
      if (elapsed > currentIntervalMs * 2) {
        doFetch().catch(() => {
          /* errors are handled inside doFetch */
        });
      }
    }
  });
  registered.push(windowStateDisposable);

  // 8. Config change listener
  const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('opencodeGoQuota.pollIntervalSeconds')) {
      scheduleNext();
    }
  });
  registered.push(configDisposable);

  // Composite disposable for cleanup
  const composite: vscode.Disposable = {
    dispose: () => {
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = undefined;
      }
      for (const d of registered) {
        d.dispose();
      }
      statusBarManager.dispose();
    },
  };

  disposables = [...registered, composite];
  context.subscriptions.push(...disposables);

  return composite;
}

export function deactivate(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = undefined;
  }
  for (const d of disposables) {
    d.dispose();
  }
  disposables = [];
}
