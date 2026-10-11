import type { QuotaSnapshot, QuotaWindow } from '../domain/types';
import { formatTime, formatPercent } from '../domain/format';
import type { Translations } from '../i18n';

export interface QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}

export interface QuickPick<T extends QuickPickItem> {
  items: T[];
  selectedItems: readonly T[];
  onDidAccept: (listener: () => void) => { dispose: () => void };
  onDidHide: (listener: () => void) => { dispose: () => void };
  show(): void;
  hide(): void;
  dispose(): void;
}

export type CreateQuickPick = <T extends QuickPickItem>() => QuickPick<T>;

/** Action behind a details item; informational items have none. */
export type DetailsAction = 'openDashboard' | 'refresh' | 'switchApiKey' | 'addApiKey' | 'removeAllApiKeys';

export interface DetailsItem extends QuickPickItem {
  action?: DetailsAction;
}

/** `42% · resets in 2h 13m`, `Limit reached — resets in 2h 13m` or `?%`. */
function windowSummary(window: QuotaWindow, t: Translations): string {
  const reset = formatTime(window.resetsInSeconds);
  switch (window.status) {
    case 'ok':
      return `${formatPercent(window.usagePercent)} · ${t.statusBarReset(reset)}`;
    case 'limit-reached':
      return t.statusBarLimitReached(reset);
    default:
      return '?%';
  }
}

/**
 * Details of the latest snapshot plus key-management actions. Resolves with the
 * accepted item's action, or undefined when hidden or an informational item is chosen.
 */
export async function showDetailQuickPick(
  snapshot: QuotaSnapshot,
  prediction: Date | null,
  historyCount: number,
  createQuickPick: CreateQuickPick,
  t: Translations,
  profileName: string | undefined,
): Promise<DetailsAction | undefined> {
  const qp = createQuickPick<DetailsItem>();

  const items: DetailsItem[] = [
    { label: `$(clock) ${t.detailsRolling}: ${windowSummary(snapshot.rolling, t)}` },
    { label: `$(calendar) ${t.detailsWeekly}: ${windowSummary(snapshot.weekly, t)}` },
    { label: `$(calendar) ${t.detailsMonthly}: ${windowSummary(snapshot.monthly, t)}` },
    {
      label: `$(trend-up) ${prediction ? t.detailsPrediction(prediction.toLocaleDateString()) : t.detailsNoPrediction}`,
    },
    { label: `$(list-unordered) ${t.detailsHistoryCount(historyCount)}` },
    { label: `$(link-external) ${t.detailsOpenDashboard}`, action: 'openDashboard' },
    { label: `$(refresh) ${t.detailsForceRefresh}`, action: 'refresh' },
  ];
  if (profileName !== undefined) {
    items.push({ label: `$(key) ${t.detailsSwitchApiKey(profileName)}`, action: 'switchApiKey' });
  }
  items.push(
    { label: `$(add) ${t.actionAddApiKey}`, action: 'addApiKey' },
    { label: `$(trash) ${t.detailsRemoveAllApiKeys}`, action: 'removeAllApiKeys' },
  );
  qp.items = items;

  return new Promise((resolve) => {
    let resolved = false;

    const acceptDisposable = qp.onDidAccept(() => {
      if (!resolved) {
        resolved = true;
        resolve(qp.selectedItems[0]?.action);
        acceptDisposable.dispose();
        hideDisposable.dispose();
        qp.dispose();
      }
    });

    const hideDisposable = qp.onDidHide(() => {
      if (!resolved) {
        resolved = true;
        resolve(undefined);
        acceptDisposable.dispose();
        hideDisposable.dispose();
        qp.dispose();
      }
    });

    qp.show();
  });
}
