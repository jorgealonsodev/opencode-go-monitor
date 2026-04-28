import type { CredentialsStorage } from '../storage/credentials';
import type { CommandsLike, WindowLike, DisposableLike } from './types';

export function registerConfigureCommand(
  credentialsStorage: CredentialsStorage,
  window: WindowLike,
  commands: CommandsLike,
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.configure', async () => {
    try {
      const workspaceId = await window.showInputBox({
        prompt:
          'Enter your OpenCode workspace ID (found in your dashboard URL after /workspace/)',
        placeHolder: 'e.g., workspace-abc123',
        ignoreFocusOut: true,
      });

      if (workspaceId === undefined) {
        return;
      }

      const authCookie = await window.showInputBox({
        prompt:
          'Enter your OpenCode auth cookie (open browser DevTools → Application → Cookies → console.opencode.ai → copy the value)',
        password: true,
        placeHolder: 'Paste your auth cookie here',
        ignoreFocusOut: true,
      });

      if (authCookie === undefined) {
        return;
      }

      const trimmedWorkspaceId = workspaceId.trim();
      const trimmedAuthCookie = authCookie.trim();

      if (!trimmedWorkspaceId || !trimmedAuthCookie) {
        await window.showErrorMessage('Both workspace ID and auth cookie are required.');
        return;
      }

      await credentialsStorage.saveCredentials(trimmedAuthCookie, trimmedWorkspaceId);
      await window.showInformationMessage(
        `OpenCode Go credentials saved for workspace ${trimmedWorkspaceId}.`,
      );
    } catch (err) {
      await window.showErrorMessage(
        `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
