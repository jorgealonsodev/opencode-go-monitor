import { AuthError, CredentialsError } from '../domain/errors';
import type { CommandsLike, WindowLike, DisposableLike } from './types';
import type { Translations } from '../i18n';
import { ADD_API_KEY_COMMAND, REPLACE_API_KEY_COMMAND, SELECT_API_KEY_COMMAND } from './apiKeys';

export interface Refreshable {
  refresh(): Promise<void>;
}

/** Manual Refresh: delegates to the poller, which owns debounce, backoff and error routing. */
export function registerRefreshCommand(poller: Refreshable, commands: CommandsLike): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.refresh', () => poller.refresh());
}

/** One notification per auth failure episode; names the profile, never the key. */
export function notifyAuthRejected(err: AuthError, window: WindowLike, commands: CommandsLike, t: Translations): void {
  void window
    .showErrorMessage(t.msgAuthRejected(err.profileName, err.httpStatus), t.actionSelectApiKey, t.actionReplaceApiKey)
    .then((choice) => {
      if (choice === t.actionSelectApiKey) {
        void commands.executeCommand(SELECT_API_KEY_COMMAND);
      } else if (choice === t.actionReplaceApiKey) {
        void commands.executeCommand(REPLACE_API_KEY_COMMAND, err.profileId);
      }
    });
}

/** Feedback for a failed manual Refresh (auth failures are reported by notifyAuthRejected). */
export function notifyRefreshFailed(err: unknown, window: WindowLike, commands: CommandsLike, t: Translations): void {
  if (err instanceof AuthError) {
    return;
  }
  if (err instanceof CredentialsError) {
    void window.showErrorMessage(t.msgNoApiKeys, t.actionAddApiKey).then((choice) => {
      if (choice === t.actionAddApiKey) {
        void commands.executeCommand(ADD_API_KEY_COMMAND);
      }
    });
    return;
  }
  void window.showErrorMessage(t.msgFailedToRefresh(err instanceof Error ? err.message : String(err)));
}
