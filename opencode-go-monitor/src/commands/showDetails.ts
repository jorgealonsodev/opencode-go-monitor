import type { HistoryStorage } from '../storage/history';
import type { CreateQuickPick, DetailsAction } from '../ui/quickPick';
import { showDetailQuickPick } from '../ui/quickPick';
import { predictExhaustion } from '../domain/prediction';
import type { CommandsLike, WindowLike, DisposableLike } from './types';
import type { Refreshable } from './refresh';
import type { Translations } from '../i18n';
import { ADD_API_KEY_COMMAND, REMOVE_ALL_API_KEYS_COMMAND, SELECT_API_KEY_COMMAND } from './apiKeys';

export interface ShowDetailsDeps {
  history: HistoryStorage;
  createQuickPick: CreateQuickPick;
  window: WindowLike;
  commands: CommandsLike;
  t: Translations;
  /** The poller: owns profile binding, debounce, auth stop and history append. */
  refresher: Refreshable;
  activeProfileName(): string | undefined;
}

const ACTION_COMMANDS: Record<DetailsAction, string> = {
  openDashboard: 'opencodeGoQuota.openDashboard',
  refresh: 'opencodeGoQuota.refresh',
  switchApiKey: SELECT_API_KEY_COMMAND,
  addApiKey: ADD_API_KEY_COMMAND,
  removeAllApiKeys: REMOVE_ALL_API_KEYS_COMMAND,
};

export function registerShowDetailsCommand(deps: ShowDetailsDeps): DisposableLike {
  const { history, createQuickPick, window, commands, t, refresher } = deps;
  return commands.registerCommand('opencodeGoQuota.showDetails', async () => {
    // Without data for the active profile, refresh once through the poller.
    if (history.getAll().length === 0 && deps.activeProfileName() !== undefined) {
      await refresher.refresh();
    }

    const entries = history.getAll();
    if (entries.length === 0) {
      const action = await window.showErrorMessage(t.msgNoDataAvailable, t.msgRefreshNow, t.actionAddApiKey);
      if (action === t.msgRefreshNow) {
        await commands.executeCommand('opencodeGoQuota.refresh');
      } else if (action === t.actionAddApiKey) {
        await commands.executeCommand(ADD_API_KEY_COMMAND);
      }
      return;
    }

    const latest = entries[entries.length - 1];
    const selected = await showDetailQuickPick(
      latest,
      predictExhaustion(entries),
      entries.length,
      createQuickPick,
      t,
      deps.activeProfileName(),
    );
    if (selected) {
      await commands.executeCommand(ACTION_COMMANDS[selected]);
    }
  });
}
