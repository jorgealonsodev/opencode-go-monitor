import type { HistoryStorage } from '../storage/history';
import type { StatusBarManager } from '../ui/statusBar';
import type { CreateQuickPick } from '../ui/quickPick';
import { showDetailQuickPick } from '../ui/quickPick';
import { predictExhaustion } from '../domain/prediction';
import type { CommandsLike, WindowLike, DisposableLike } from './types';

export function registerShowDetailsCommand(
  historyStorage: HistoryStorage,
  statusBarManager: StatusBarManager,
  createQuickPick: CreateQuickPick,
  window: WindowLike,
  commands: CommandsLike,
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.showDetails', async () => {
    const history = historyStorage.getAll();
    if (history.length === 0) {
      await window.showErrorMessage('No quota data available. Please refresh first.');
      return;
    }

    const latest = history[history.length - 1];
    const prediction = predictExhaustion(history);

    await showDetailQuickPick(latest, prediction, history.length, createQuickPick);
  });
}
