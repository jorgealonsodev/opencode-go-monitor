import type { ActiveKeyProvider, QuotaFetcher, QuotaSnapshot } from '../domain/types';
import { AuthError } from '../domain/errors';
import {
  ProfileValidationError,
  isValidApiKey,
  normalizeApiKey,
  normalizeProfileName,
  validateProfileName,
  type Profile,
  type ProfileStore,
  type ProfileValidationReason,
} from '../storage/profiles';
import type { CommandsLike, DisposableLike, QuickPickItemLike, WindowLike } from './types';
import type { Translations } from '../i18n';

export const ADD_API_KEY_COMMAND = 'opencodeGoQuota.configure';
export const SELECT_API_KEY_COMMAND = 'opencodeGoQuota.selectApiKey';
export const RENAME_API_KEY_COMMAND = 'opencodeGoQuota.renameApiKey';
export const REPLACE_API_KEY_COMMAND = 'opencodeGoQuota.replaceApiKey';
export const REMOVE_API_KEY_COMMAND = 'opencodeGoQuota.removeApiKey';
export const REMOVE_ALL_API_KEYS_COMMAND = 'opencodeGoQuota.clearCredentials';

export interface ApiKeyCommandDeps {
  store: ProfileStore;
  window: WindowLike;
  commands: CommandsLike;
  t: Translations;
  /** Builds a fetcher for a one-off key provider (used to validate candidate keys). */
  createFetcher(keys: ActiveKeyProvider): QuotaFetcher;
  /**
   * The active profile was selected, added, replaced or removed. `initial` is a
   * validation response that becomes the first snapshot (no second request).
   */
  onActiveProfileChanged(initial?: QuotaSnapshot): void | Promise<void>;
}

interface ProfilePickItem extends QuickPickItemLike {
  profileId: string;
}

interface VerifiedKey {
  key: string;
  snapshot?: QuotaSnapshot;
}

/** Registers Add/Select/Rename/Replace/Remove/Remove All API Key commands (FR1). */
export function registerApiKeyCommands(deps: ApiKeyCommandDeps): DisposableLike[] {
  const { store, window, commands, t } = deps;

  function reasonMessage(reason: ProfileValidationReason, rawName = ''): string {
    switch (reason) {
      case 'required':
        return t.errNameRequired;
      case 'tooLong':
        return t.errNameTooLong;
      case 'forbidden':
        return t.errNameForbidden;
      case 'duplicate':
        return t.errNameDuplicate(normalizeProfileName(rawName));
      case 'invalidKey':
        return t.errKeyInvalid;
    }
  }

  function validateName(excludeId?: string) {
    return (value: string): string | undefined => {
      const error = validateProfileName(value, store.list(), excludeId);
      return error ? reasonMessage(error, value) : undefined;
    };
  }

  const validateKey = (value: string): string | undefined => (isValidApiKey(value) ? undefined : t.errKeyInvalid);

  /** Asks for a key and validates it with one usage request; undefined means cancelled. */
  async function askAndVerifyKey(prompt: string, id: string, name: string): Promise<VerifiedKey | undefined> {
    for (;;) {
      const raw = await window.showInputBox({ prompt, password: true, ignoreFocusOut: true, validateInput: validateKey });
      if (raw === undefined) {
        return undefined;
      }
      if (!isValidApiKey(raw)) {
        await window.showErrorMessage(t.errKeyInvalid);
        return undefined;
      }
      const key = normalizeApiKey(raw);
      const oneOff: ActiveKeyProvider = { getActive: async () => ({ id, name, key }) };
      try {
        return { key, snapshot: await deps.createFetcher(oneOff).fetch() };
      } catch (err) {
        if (err instanceof AuthError) {
          const choice = await window.showErrorMessage(
            t.msgKeyRejected,
            t.actionTryAgain,
            t.actionSaveAnyway,
            t.actionCancel,
          );
          if (choice === t.actionTryAgain) {
            continue;
          }
          return choice === t.actionSaveAnyway ? { key } : undefined;
        }
        const reason = err instanceof Error ? err.message : String(err);
        const choice = await window.showErrorMessage(t.msgKeyUnverified(reason), t.actionSaveAnyway, t.actionCancel);
        return choice === t.actionSaveAnyway ? { key } : undefined;
      }
    }
  }

  async function pickProfile(placeHolder: string): Promise<Profile | undefined> {
    const profiles = store.list();
    if (profiles.length === 0) {
      void window.showInformationMessage(t.msgNoApiKeys, t.actionAddApiKey).then((choice) => {
        if (choice === t.actionAddApiKey) {
          void commands.executeCommand(ADD_API_KEY_COMMAND);
        }
      });
      return undefined;
    }
    const activeId = store.getActiveProfile()?.id;
    const items: ProfilePickItem[] = await Promise.all(
      profiles.map(async (p) => ({
        label: p.id === activeId ? `$(check) ${p.name}` : p.name,
        description: await store.getKeyHint(p.id),
        profileId: p.id,
      })),
    );
    const picked = await window.showQuickPick(items, { placeHolder });
    return picked ? profiles.find((p) => p.id === picked.profileId) : undefined;
  }

  /** Non-blocking "Saved '<name>'." with a "Monitor <name>" action. */
  function offerMonitor(profile: Profile): void {
    const monitor = t.actionMonitor(profile.name);
    void window.showInformationMessage(t.msgKeySaved(profile.name), monitor).then(async (choice) => {
      if (choice === monitor && store.list().some((p) => p.id === profile.id)) {
        await store.setActive(profile.id);
        await deps.onActiveProfileChanged();
      }
    });
  }

  async function guarded(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (err) {
      const message =
        err instanceof ProfileValidationError
          ? reasonMessage(err.reason)
          : err instanceof Error
            ? err.message
            : String(err);
      await window.showErrorMessage(t.msgApiKeyOperationFailed(message));
    }
  }

  async function confirm(message: string, action: string): Promise<boolean> {
    return (await window.showWarningMessage(message, { modal: true }, action)) === action;
  }

  const addApiKey = () =>
    guarded(async () => {
      const rawName = await window.showInputBox({
        prompt: t.promptApiKeyName,
        placeHolder: t.promptApiKeyNamePlaceholder,
        ignoreFocusOut: true,
        validateInput: validateName(),
      });
      if (rawName === undefined) {
        return;
      }
      // Placeholder id for validation; the snapshot is re-bound to the real id below.
      const verified = await askAndVerifyKey(t.promptApiKey, 'pending', normalizeProfileName(rawName));
      if (!verified) {
        return;
      }
      const profile = await store.add(rawName, verified.key);
      if (store.getActiveProfile()?.id === profile.id) {
        const snapshot = verified.snapshot ? { ...verified.snapshot, profileId: profile.id } : undefined;
        await deps.onActiveProfileChanged(snapshot);
      } else {
        offerMonitor(profile);
      }
    });

  const selectApiKey = () =>
    guarded(async () => {
      if (store.list().length === 0) {
        await commands.executeCommand(ADD_API_KEY_COMMAND);
        return;
      }
      const profile = await pickProfile(t.pickSelectApiKey);
      if (!profile) {
        return;
      }
      await store.setActive(profile.id);
      await deps.onActiveProfileChanged();
    });

  const renameApiKey = () =>
    guarded(async () => {
      const profile = await pickProfile(t.pickRenameApiKey);
      if (!profile) {
        return;
      }
      const rawName = await window.showInputBox({
        prompt: t.promptRenameApiKey(profile.name),
        value: profile.name,
        ignoreFocusOut: true,
        validateInput: validateName(profile.id),
      });
      if (rawName === undefined) {
        return;
      }
      await store.rename(profile.id, rawName);
    });

  const replaceApiKey = (profileId?: unknown) =>
    guarded(async () => {
      const profile =
        typeof profileId === 'string'
          ? store.list().find((p) => p.id === profileId)
          : await pickProfile(t.pickReplaceApiKey);
      if (!profile) {
        return;
      }
      const verified = await askAndVerifyKey(t.promptReplaceApiKey(profile.name), profile.id, profile.name);
      if (!verified) {
        return;
      }
      await store.replaceKey(profile.id, verified.key);
      if (store.getActiveProfile()?.id === profile.id) {
        await deps.onActiveProfileChanged(verified.snapshot);
      } else {
        offerMonitor(profile);
      }
    });

  const removeApiKey = () =>
    guarded(async () => {
      const profile = await pickProfile(t.pickRemoveApiKey);
      if (!profile || !(await confirm(t.msgConfirmRemove(profile.name), t.actionRemove))) {
        return;
      }
      const wasActive = store.getActiveProfile()?.id === profile.id;
      const next = await store.remove(profile.id);
      if (!wasActive) {
        void window.showInformationMessage(t.msgRemoved(profile.name));
        return;
      }
      if (next) {
        void window.showInformationMessage(t.msgRemovedNowMonitoring(profile.name, next.name));
      }
      await deps.onActiveProfileChanged();
    });

  const removeAllApiKeys = () =>
    guarded(async () => {
      const count = store.list().length;
      if (count === 0 || !(await confirm(t.msgConfirmRemoveAll(count), t.actionRemoveAll))) {
        return;
      }
      await store.removeAll();
      await deps.onActiveProfileChanged();
    });

  return [
    commands.registerCommand(ADD_API_KEY_COMMAND, addApiKey),
    commands.registerCommand(SELECT_API_KEY_COMMAND, selectApiKey),
    commands.registerCommand(RENAME_API_KEY_COMMAND, renameApiKey),
    commands.registerCommand(REPLACE_API_KEY_COMMAND, replaceApiKey),
    commands.registerCommand(REMOVE_API_KEY_COMMAND, removeApiKey),
    commands.registerCommand(REMOVE_ALL_API_KEYS_COMMAND, removeAllApiKeys),
  ];
}
