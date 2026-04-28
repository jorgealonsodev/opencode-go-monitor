import type { FetcherSelector } from '../fetchers/FetcherSelector';
import type { HistoryStorage } from '../storage/history';
import type { StatusBarManager } from '../ui/statusBar';
import type { CommandsLike, WindowLike, DisposableLike } from './types';

export function registerRefreshCommand(
  fetcherSelector: FetcherSelector,
  historyStorage: HistoryStorage,
  statusBarManager: StatusBarManager,
  window: WindowLike,
  commands: CommandsLike,
  thresholds: { warning: number; error: number } = { warning: 80, error: 95 },
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.refresh', async () => {
    statusBarManager.setState('loading');

    try {
      const snapshot = await fetcherSelector.fetch();
      await historyStorage.append(snapshot);
      statusBarManager.update(snapshot, thresholds);
      await window.showInformationMessage(
        `Quota refreshed. Monthly usage: ${Math.round(snapshot.monthly.usagePercent)}%.`,
      );
    } catch (err) {
      statusBarManager.setState('error');
      await window.showErrorMessage(
        `Failed to refresh quota: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
