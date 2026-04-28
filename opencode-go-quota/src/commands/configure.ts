import type { CredentialsStorage } from '../storage/credentials';
import type { CommandsLike, WindowLike, DisposableLike } from './types';
import type { Translations } from '../i18n';

export function registerConfigureCommand(
  credentialsStorage: CredentialsStorage,
  window: WindowLike,
  commands: CommandsLike,
  t: Translations,
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.configure', async () => {
    try {
      const workspaceId = await window.showInputBox({
        prompt: t.promptWorkspaceId,
        placeHolder: t.promptWorkspaceIdPlaceholder,
        ignoreFocusOut: true,
      });

      if (workspaceId === undefined) {
        return;
      }

      const authCookie = await window.showInputBox({
        prompt: t.promptAuthCookie,
        password: true,
        placeHolder: t.promptAuthCookiePlaceholder,
        ignoreFocusOut: true,
      });

      if (authCookie === undefined) {
        return;
      }

      const trimmedWorkspaceId = workspaceId.trim();
      const trimmedAuthCookie = authCookie.trim();

      if (!trimmedWorkspaceId || !trimmedAuthCookie) {
        await window.showErrorMessage(t.msgCredentialsRequired);
        return;
      }

      await credentialsStorage.saveCredentials(trimmedAuthCookie, trimmedWorkspaceId);
      await window.showInformationMessage(t.msgCredentialsSaved(trimmedWorkspaceId));
    } catch (err) {
      await window.showErrorMessage(t.msgFailedToSave(err instanceof Error ? err.message : String(err)));
    }
  });
}
