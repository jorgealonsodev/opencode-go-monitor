import type { HistoryStorage } from '../storage/history';
import type { StatusBarManager } from '../ui/statusBar';
import type { CreateQuickPick } from '../ui/quickPick';
import { showDetailQuickPick } from '../ui/quickPick';
import { predictExhaustion } from '../domain/prediction';
import type { CommandsLike, WindowLike, DisposableLike } from './types';
import type { FetcherSelector } from '../fetchers/FetcherSelector';
import type { Translations } from '../i18n';

type DisplayWindow = 'rolling' | 'weekly' | 'monthly';

export function registerShowDetailsCommand(
  historyStorage: HistoryStorage,
  statusBarManager: StatusBarManager,
  createQuickPick: CreateQuickPick,
  window: WindowLike,
  commands: CommandsLike,
  fetcherSelector?: FetcherSelector,
  displayWindow: DisplayWindow = 'rolling',
  t?: Translations,
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.showDetails', async () => {
    let history = historyStorage.getAll();
    
    // If no history, try to fetch once before showing error
    if (history.length === 0 && fetcherSelector) {
      statusBarManager.setState('loading');
      try {
        const snapshot = await fetcherSelector.fetch();
        await historyStorage.append(snapshot);
        history = historyStorage.getAll();
        statusBarManager.update(snapshot, { warning: 80, error: 95 }, displayWindow);
      } catch {
        // Fetch failed, fall through to error message
      }
    }

    if (history.length === 0) {
      const msg = t?.msgNoDataAvailable ?? 'No quota data available. Try refreshing manually.';
      const refreshLabel = t?.msgRefreshNow ?? 'Refresh Now';
      const configLabel = t?.msgConfigureCredentials ?? 'Configure Credentials';
      
      const action = await window.showErrorMessage(msg, refreshLabel, configLabel);
      
      if (action === refreshLabel) {
        await commands.executeCommand('opencodeGoQuota.refresh');
      } else if (action === configLabel) {
        await commands.executeCommand('opencodeGoQuota.configure');
      }
      return;
    }

    const latest = history[history.length - 1];
    const prediction = predictExhaustion(history);

    const selected = await showDetailQuickPick(latest, prediction, history.length, createQuickPick, t);

    // Handle actions from QuickPick
    if (selected) {
      if (selected.includes('$(refresh)')) {
        await commands.executeCommand('opencodeGoQuota.refresh');
      } else if (selected.includes('$(gear)')) {
        await commands.executeCommand('opencodeGoQuota.configure');
      } else if (selected.includes('$(sign-out)')) {
        await commands.executeCommand('opencodeGoQuota.clearCredentials');
      } else if (selected.includes('$(link-external)')) {
        await commands.executeCommand('opencodeGoQuota.openDashboard');
      }
    }
  });
}
