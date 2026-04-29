import type { CommandsLike, WindowLike, DisposableLike, WorkspaceConfigurationLike } from './types';
import type { Translations } from '../i18n';

const DISPLAY_WINDOW_KEY = 'displayWindow';

export function registerSelectDisplayWindowCommand(
  config: WorkspaceConfigurationLike,
  window: WindowLike,
  commands: CommandsLike,
  t: Translations,
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.selectDisplayWindow', async () => {
    const items = [
      { label: t.pickRollingLabel, value: 'rolling' as const, description: t.pickRollingDesc },
      { label: t.pickWeeklyLabel, value: 'weekly' as const, description: t.pickWeeklyDesc },
      { label: t.pickMonthlyLabel, value: 'monthly' as const, description: t.pickMonthlyDesc },
    ];

    const current = config.get<string>(DISPLAY_WINDOW_KEY, 'rolling');
    const selected = await window.showQuickPick(
      items.map((item) => ({
        label: item.label,
        description: item.description,
        detail: item.value === current ? t.pickCurrent : undefined,
        value: item.value,
      })),
      {
        placeHolder: t.pickDisplayWindowPlaceholder,
      }
    );

    if (!selected) {
      return;
    }

    await config.update(DISPLAY_WINDOW_KEY, selected.value);
    await window.showInformationMessage(t.msgWindowChanged(selected.label));
  });
}
