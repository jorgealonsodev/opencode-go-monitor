import type { CredentialsStorage } from '../storage/credentials';
import type { StatusBarManager } from '../ui/statusBar';
import type { CommandsLike, WindowLike, DisposableLike } from './types';
import type { Translations } from '../i18n';

export function registerClearCredentialsCommand(
  credentialsStorage: CredentialsStorage,
  statusBarManager: StatusBarManager,
  window: WindowLike,
  commands: CommandsLike,
  t: Translations,
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.clearCredentials', async () => {
    try {
      await credentialsStorage.clearCredentials();
      statusBarManager.setState('setup');
      await window.showInformationMessage(t.msgCredentialsCleared);
    } catch (err) {
      await window.showErrorMessage(t.msgFailedToSave(err instanceof Error ? err.message : String(err)));
    }
  });
}
