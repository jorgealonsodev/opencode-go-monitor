import type { FetcherSelector } from '../fetchers/FetcherSelector';
import type { HistoryStorage } from '../storage/history';
import type { StatusBarManager } from '../ui/statusBar';
import type { CommandsLike, WindowLike, DisposableLike } from './types';
import type { Translations } from '../i18n';

type DisplayWindow = 'rolling' | 'weekly' | 'monthly';

export function registerRefreshCommand(
  fetcherSelector: FetcherSelector,
  historyStorage: HistoryStorage,
  statusBarManager: StatusBarManager,
  window: WindowLike,
  commands: CommandsLike,
  thresholds: { warning: number; error: number } = { warning: 80, error: 95 },
  displayWindow: DisplayWindow = 'rolling',
  t?: Translations,
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.refresh', async () => {
    statusBarManager.setState('loading');

    try {
      const snapshot = await fetcherSelector.fetch();
      await historyStorage.append(snapshot);
      statusBarManager.update(snapshot, thresholds, displayWindow);
      if (t) {
        await window.showInformationMessage(t.msgQuotaRefreshed(Math.round(snapshot[displayWindow].usagePercent)));
      } else {
        await window.showInformationMessage(`Quota refreshed. Usage: ${Math.round(snapshot[displayWindow].usagePercent)}%.`);
      }
    } catch (err) {
      statusBarManager.setState('error');
      if (t) {
        await window.showErrorMessage(t.msgFailedToRefresh(err instanceof Error ? err.message : String(err)));
      } else {
        await window.showErrorMessage(`Failed to refresh quota: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
}
