import * as vscode from 'vscode';
import { ProfileStore, HistoryStorage, removeLegacyData } from './storage';
import { UsageFetcher } from './fetchers';
import { StatusBarManager, singleClickCommand } from './ui/statusBar';
import {
  ADD_API_KEY_COMMAND,
  registerApiKeyCommands,
  registerRefreshCommand,
  registerShowDetailsCommand,
  registerExportHistoryCommand,
  registerOpenDashboardCommand,
  registerSelectDisplayWindowCommand,
  notifyAuthRejected,
  notifyRefreshFailed,
} from './commands';
import { QuotaPoller } from './polling/QuotaPoller';
import type { QuickPick, QuickPickItem } from './ui/quickPick';
import { getTranslations, detectLocale, type Locale } from './i18n';

let disposables: vscode.Disposable[] = [];

// Double-click detection for status bar
let statusBarClickTimer: NodeJS.Timeout | undefined;
let statusBarClickCount = 0;
const DOUBLE_CLICK_DELAY_MS = 300;

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
  const item = vscode.window.createStatusBarItem('opencodeGoQuota', alignment as vscode.StatusBarAlignment, priority);
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
      return item.command as string | undefined;
    },
    set command(value: string | undefined) {
      item.command = value;
    },
    get color() {
      return item.color;
    },
    set color(value: string | import('./ui/statusBar').ThemeColor | undefined) {
      if (value && typeof value === 'object' && 'id' in value) {
        item.color = new vscode.ThemeColor(value.id);
      } else {
        item.color = value as any;
      }
    },
    get backgroundColor() {
      return item.backgroundColor as string | import('./ui/statusBar').ThemeColor | undefined;
    },
    set backgroundColor(value: string | import('./ui/statusBar').ThemeColor | undefined) {
      if (value && typeof value === 'object' && 'id' in value) {
        item.backgroundColor = new vscode.ThemeColor(value.id);
      } else {
        item.backgroundColor = value as any;
      }
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
  globalThis.opencodeGoQuotaDebug = (msg: string) => {
    outputChannel.appendLine(msg);
  };

  // 1. Initialize i18n
  const locale: Locale = detectLocale();
  const t = getTranslations(locale);
  outputChannel.appendLine(`[init] locale: ${locale}`);

  // 2. Initialize storage (pre-1.0 legacy data is removed first)
  await removeLegacyData(context.globalState, context.secrets, () => {
    void vscode.window.showInformationMessage(t.msgLegacyNotice, t.actionAddApiKey).then((choice) => {
      if (choice === t.actionAddApiKey) {
        void vscode.commands.executeCommand(ADD_API_KEY_COMMAND);
      }
    });
  });
  const profileStore = new ProfileStore(context.globalState, context.secrets);
  const historyStorage = new HistoryStorage(context.globalState);
  await historyStorage.cleanup();
  outputChannel.appendLine(`[init] Storage initialized: ${profileStore.list().length} API key(s)`);

  // 3. Initialize fetcher (the active profile supplies the key)
  const fetcher = new UsageFetcher(profileStore);

  // 4. Initialize UI
  const statusBarManager = new StatusBarManager(createStatusBarItemAdapter, t);
  statusBarManager.create();

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

  // 6. Polling (single owner of backoff, Retry-After, debounce and profile binding)
  const poller = new QuotaPoller({
    fetcher,
    activeProfileId: () => profileStore.getActiveProfile()?.id,
    onSnapshot: async (snapshot) => {
      await historyStorage.append(snapshot);
      statusBarManager.update(snapshot, thresholds, displayWindow);
    },
    setState: (state) => statusBarManager.setState(state),
    onAuthError: (err) => notifyAuthRejected(err, vscode.window, vscode.commands, t),
    onManualRefreshError: (err) => notifyRefreshFailed(err, vscode.window, vscode.commands, t),
    pollIntervalMs: () => readPollInterval() * 1000,
    log: (msg) => outputChannel.appendLine(msg),
  });
  poller.start();

  // 7. Register commands
  const registered: vscode.Disposable[] = [];

  registered.push(
    ...registerApiKeyCommands({
      store: profileStore,
      window: vscode.window,
      commands: vscode.commands,
      t,
      createFetcher: (keys) => new UsageFetcher(keys),
      onActiveProfileChanged: (initial) => poller.activeProfileChanged(initial),
    })
  );

  registered.push(registerRefreshCommand(poller, vscode.commands));

  registered.push(
    registerShowDetailsCommand(
      historyStorage,
      statusBarManager,
      createQuickPickAdapter,
      vscode.window,
      vscode.commands,
      fetcher,
      displayWindow,
      t
    )
  );

  registered.push(
    registerExportHistoryCommand(historyStorage, vscode.window, vscode.commands, t)
  );

  registered.push(
    registerOpenDashboardCommand(vscode.env, vscode.commands, {
      parse: (uri: string) =>
        ({ fsPath: uri, toString: () => uri, scheme: 'https' }) as import('./commands/types').UriLike,
    })
  );

  registered.push(
    registerSelectDisplayWindowCommand(config, vscode.window, vscode.commands, t)
  );

  // Status bar click handler: single click depends on state (setup → Add API Key,
  // auth → Select API Key, otherwise Refresh); double click = details
  registered.push(
    vscode.commands.registerCommand('opencodeGoQuota.statusBarClick', async () => {
      statusBarClickCount++;

      if (statusBarClickCount === 1) {
        // First click - wait to see if it's a double click
        statusBarClickTimer = setTimeout(async () => {
          statusBarClickCount = 0;
          statusBarClickTimer = undefined;
          const command = singleClickCommand(statusBarManager.state);
          outputChannel.appendLine(`[statusbar] single click - ${command}`);
          await vscode.commands.executeCommand(command);
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

  // 8. Sleep/resume detection
  registered.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        poller.windowFocused();
      }
    })
  );

  // 9. Config change listener
  const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('opencodeGoQuota.pollIntervalSeconds')) {
      poller.restartSchedule();
    }
    if (e.affectsConfiguration('opencodeGoQuota.displayWindow')) {
      displayWindow = config.get<DisplayWindow>('displayWindow', 'rolling');
      outputChannel.appendLine(`[config] displayWindow changed to: ${displayWindow}`);
      // Re-render the latest snapshot with the new window
      const history = historyStorage.getAll();
      if (history.length > 0 && statusBarManager.state === 'active') {
        statusBarManager.update(history[history.length - 1], thresholds, displayWindow);
      }
    }
  });
  registered.push(configDisposable);

  // Composite disposable for cleanup
  const composite: vscode.Disposable = {
    dispose: () => {
      poller.dispose();
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
  for (const d of disposables) {
    d.dispose();
  }
  disposables = [];
  // API keys persist in SecretStorage across sessions; the user removes them explicitly.
}
