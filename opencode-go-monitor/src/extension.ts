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
  registerSelectDisplayWindowCommand,
} from './commands';
import { CredentialsError } from './domain/errors';
import type { QuotaSnapshot } from './domain/types';
import type { QuickPick, QuickPickItem } from './ui/quickPick';
import { getTranslations, detectLocale, type Translations, type Locale } from './i18n';

let pollingTimer: NodeJS.Timeout | undefined;
let disposables: vscode.Disposable[] = [];
let lastFetchTime = 0;

// Double-click detection for status bar
let statusBarClickTimer: NodeJS.Timeout | undefined;
let statusBarClickCount = 0;
const DOUBLE_CLICK_DELAY_MS = 300;

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

function createStatusBarItemAdapter(alignment: number, priority: number): import('./ui/statusBar').StatusBarItem {
  const item = vscode.window.createStatusBarItem(alignment as vscode.StatusBarAlignment, priority);
  return {
    get text() {
      return item.text;
    },
    set text(value: string) {
      item.text = value;
    },
    get tooltip() {
      return item.tooltip as string;
    },
    set tooltip(value: string | { value: string; isTrusted?: boolean } | undefined) {
      if (typeof value === 'string') {
        // Check if it contains markdown syntax
        if (value.includes('**') || value.includes('\n')) {
          const md = new vscode.MarkdownString(value);
          md.isTrusted = true;
          item.tooltip = md;
        } else {
          item.tooltip = value;
        }
      } else if (value && typeof value === 'object' && 'value' in value) {
        const md = new vscode.MarkdownString(value.value);
        md.isTrusted = value.isTrusted ?? true;
        item.tooltip = md;
      } else {
        item.tooltip = undefined;
      }
    },
    get command() {
      return item.command;
    },
    set command(value: string | undefined) {
      item.command = value;
    },
    get color() {
      return item.color;
    },
    set color(value: string | import('./ui/statusBar').ThemeColor | undefined) {
      item.color = value as any;
    },
    show: () => item.show(),
    hide: () => item.hide(),
    dispose: () => item.dispose(),
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<vscode.Disposable> {
  // Output channel for debugging
  const outputChannel = vscode.window.createOutputChannel('OpenCode Go Quota');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('=== OpenCode Go Quota extension activated ===');
  outputChannel.appendLine(`VSCode version: ${vscode.version}`);
  outputChannel.appendLine(`Extension path: ${context.extensionPath}`);

  // Expose debug function globally for fetchers to use
  (globalThis as any).opencodeGoQuotaDebug = (msg: string) => {
    outputChannel.appendLine(msg);
  };

  // 1. Initialize storage
  const credentialsStorage = new CredentialsStorage(context.secrets);
  const historyStorage = new HistoryStorage(context.globalState);
  await historyStorage.cleanup();
  outputChannel.appendLine('[init] Storage initialized');

  // 2. Initialize fetchers
  const scrapingFetcher = new ScrapingFetcher(credentialsStorage);
  const apiFetcher = new ApiFetcher(credentialsStorage);
  const fetcherSelector = new FetcherSelector(apiFetcher, scrapingFetcher, historyStorage);

  // 3. Initialize i18n
  const locale: Locale = detectLocale();
  const t = getTranslations(locale);
  outputChannel.appendLine(`[init] locale: ${locale}`);

  // 4. Initialize UI
  const statusBarManager = new StatusBarManager(createStatusBarItemAdapter, t);
  statusBarManager.create();

  // 4. Set initial state based on credentials
  const hasCreds = await credentialsStorage.hasCredentials();
  outputChannel.appendLine(`[init] hasCredentials: ${hasCreds}`);
  
  if (hasCreds) {
    const creds = await credentialsStorage.getCredentials();
    outputChannel.appendLine(`[init] workspaceId: ${creds?.workspaceId}`);
    outputChannel.appendLine(`[init] authCookie (masked): ${creds ? credentialsStorage.maskCookie(creds.authCookie) : 'N/A'}`);
  }
  
  if (!hasCreds) {
    outputChannel.appendLine('[init] no credentials found, showing setup state');
    statusBarManager.setState('setup');
  } else {
    outputChannel.appendLine('[init] credentials found, showing loading state');
    statusBarManager.setState('loading');
  }

  // 5. Read thresholds from config
  const config = getConfig();
  const thresholds = {
    warning: config.get<number>('warningThreshold', 80),
    error: config.get<number>('errorThreshold', 95),
  };

  // Read display window preference
  type DisplayWindow = 'rolling' | 'weekly' | 'monthly';
  let displayWindow: DisplayWindow = config.get<DisplayWindow>('displayWindow', 'rolling');
  outputChannel.appendLine(`[init] displayWindow: ${displayWindow}`);

  // Polling state
  let isFetching = false;
  let pollFailureCount = 0;
  let lastPollFailureTime = 0;
  let currentIntervalMs = readPollInterval() * 1000;
  let lastFailureState: 'auth' | 'error' | null = null;

  function getPollBackoffMs(): number {
    if (pollFailureCount === 0) {
      return 0;
    }
    // Defensive: if lastPollFailureTime is 0 but count is > 0, reset count
    if (lastPollFailureTime === 0) {
      pollFailureCount = 0;
      return 0;
    }
    const stage = Math.min(pollFailureCount - 1, POLL_BACKOFF_DELAYS_MS.length - 1);
    const delay = POLL_BACKOFF_DELAYS_MS[stage];
    const elapsed = Date.now() - lastPollFailureTime;
    const remaining = Math.max(0, delay - elapsed);
    // Avoid micro-backoffs due to timer drift (e.g. "waiting 5ms")
    return remaining < 1000 ? 0 : remaining;
  }

  async function doFetch(): Promise<void> {
    const backoffMs = getPollBackoffMs();
    if (backoffMs > 0) {
      outputChannel.appendLine(`[fetch] backoff: waiting ${backoffMs}ms before next fetch`);
      // If the last failure was an auth error, keep showing auth state so the user
      // continues to see that credentials are invalid/expired. Otherwise, restore
      // the last known good data instead of leaving the status bar stuck on error/loading.
      if (lastFailureState === 'auth') {
        statusBarManager.setState('auth');
        return;
      }
      const history = historyStorage.getAll();
      if (history.length > 0) {
        statusBarManager.update(history[history.length - 1], thresholds, displayWindow);
      }
      return;
    }

    if (isFetching) {
      outputChannel.appendLine('[fetch] already fetching, skipping');
      return;
    }

    isFetching = true;
    statusBarManager.setState('loading');
    try {
      outputChannel.appendLine('[fetch] === starting quota fetch ===');
      const snapshot = await fetcherSelector.fetch();
      await historyStorage.append(snapshot);
      statusBarManager.update(snapshot, thresholds, displayWindow);
      lastFetchTime = Date.now();
      pollFailureCount = 0;
      lastPollFailureTime = 0;
      lastFailureState = null;
      outputChannel.appendLine(`[fetch] SUCCESS: source=${snapshot.source}`);
      outputChannel.appendLine(`[fetch] rolling=${snapshot.rolling.usagePercent}%, weekly=${snapshot.weekly.usagePercent}%, monthly=${snapshot.monthly.usagePercent}%`);
    } catch (err) {
      pollFailureCount++;
      lastPollFailureTime = Date.now();
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.constructor.name : 'Unknown';
      outputChannel.appendLine(`[fetch] FAILED: ${errorName}: ${errorMsg}`);
      // SECURITY: Do not log stack traces - they reveal internal file paths and structure
      if (err instanceof CredentialsError) {
        lastFailureState = 'auth';
        outputChannel.appendLine('[fetch] -> setting state: auth (credentials missing or invalid)');
        statusBarManager.setState('auth');
        // Prompt user to re-configure if credentials are missing
        vscode.window.showErrorMessage('OpenCode Go credentials are missing. Please re-configure.', 'Configure Now').then((action) => {
          if (action === 'Configure Now') {
            vscode.commands.executeCommand('opencodeGoQuota.configure');
          }
        });
      } else {
        lastFailureState = 'error';
        outputChannel.appendLine('[fetch] -> setting state: error');
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
    registerConfigureCommand(credentialsStorage, vscode.window, vscode.commands, t)
  );

  registered.push(
    registerRefreshCommand(
      fetcherSelector,
      historyStorage,
      statusBarManager,
      vscode.window,
      vscode.commands,
      thresholds,
      displayWindow,
      t
    )
  );

  registered.push(
    registerShowDetailsCommand(
      historyStorage,
      statusBarManager,
      createQuickPickAdapter,
      vscode.window,
      vscode.commands,
      fetcherSelector,
      displayWindow,
      t
    )
  );

  registered.push(
    registerExportHistoryCommand(historyStorage, vscode.window, vscode.commands, t)
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
    registerClearCredentialsCommand(credentialsStorage, statusBarManager, vscode.window, vscode.commands, t)
  );

  registered.push(
    registerSelectDisplayWindowCommand(config, vscode.window, vscode.commands, t)
  );

  // Status bar click handler: single click = refresh, double click = details
  registered.push(
    vscode.commands.registerCommand('opencodeGoQuota.statusBarClick', async () => {
      statusBarClickCount++;
      
      if (statusBarClickCount === 1) {
        // First click - wait to see if it's a double click
        statusBarClickTimer = setTimeout(async () => {
          statusBarClickCount = 0;
          statusBarClickTimer = undefined;
          // Single click detected - refresh
          outputChannel.appendLine('[statusbar] single click - refreshing');
          await vscode.commands.executeCommand('opencodeGoQuota.refresh');
        }, DOUBLE_CLICK_DELAY_MS);
      } else if (statusBarClickCount === 2) {
        // Second click within delay - double click detected
        if (statusBarClickTimer) {
          clearTimeout(statusBarClickTimer);
          statusBarClickTimer = undefined;
        }
        statusBarClickCount = 0;
        // Double click detected - show details
        outputChannel.appendLine('[statusbar] double click - showing details');
        await vscode.commands.executeCommand('opencodeGoQuota.showDetails');
      }
    })
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
    if (e.affectsConfiguration('opencodeGoQuota.displayWindow')) {
      displayWindow = config.get<DisplayWindow>('displayWindow', 'rolling');
      outputChannel.appendLine(`[config] displayWindow changed to: ${displayWindow}`);
      // Re-fetch to update status bar with new window
      if (lastFetchTime > 0) {
        const history = historyStorage.getAll();
        if (history.length > 0) {
          statusBarManager.update(history[history.length - 1], thresholds, displayWindow);
        }
      }
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
      if (statusBarClickTimer) {
        clearTimeout(statusBarClickTimer);
        statusBarClickTimer = undefined;
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
  // Clear sensitive data from memory
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = undefined;
  }
  for (const d of disposables) {
    d.dispose();
  }
  disposables = [];
  
  // Note: We don't clear credentials here as they should persist
  // across VSCode sessions. The user must explicitly logout.
}
