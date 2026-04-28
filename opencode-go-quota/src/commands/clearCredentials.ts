import type { CredentialsStorage } from '../storage/credentials';
import type { StatusBarManager } from '../ui/statusBar';
import type { CommandsLike, WindowLike, DisposableLike } from './types';

export function registerClearCredentialsCommand(
  credentialsStorage: CredentialsStorage,
  statusBarManager: StatusBarManager,
  window: WindowLike,
  commands: CommandsLike,
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.clearCredentials', async () => {
    try {
      await credentialsStorage.clearCredentials();
      statusBarManager.setState('setup');
      await window.showInformationMessage('OpenCode Go credentials cleared.');
    } catch (err) {
      await window.showErrorMessage(
        `Failed to clear credentials: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
