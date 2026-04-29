import type { QuotaSnapshot } from '../domain/types';
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

export async function showDetailQuickPick(
  snapshot: QuotaSnapshot,
  prediction: Date | null,
  historyCount: number,
  createQuickPick: CreateQuickPick,
  t?: Translations,
): Promise<string | undefined> {
  const qp = createQuickPick<QuickPickItem>();

  const rollingLabel = t?.detailsRolling ?? 'Rolling';
  const weeklyLabel = t?.detailsWeekly ?? 'Weekly';
  const monthlyLabel = t?.detailsMonthly ?? 'Monthly';
  const predictionLabel = t?.detailsPrediction ?? ((time: string) => `Predicted exhaustion: ${time}`);
  const noPredictionLabel = t?.detailsNoPrediction ?? 'Predicted exhaustion: Insufficient data';
  const historyLabel = t?.detailsHistoryCount ?? ((count: number) => `View history (${count} entries)`);

  qp.items = [
    {
      label: `$(clock) ${rollingLabel}: ${formatPercent(snapshot.rolling.usagePercent)} · ${t?.statusBarReset(formatTime(snapshot.rolling.resetsInSeconds)) ?? `resets in ${formatTime(snapshot.rolling.resetsInSeconds)}`}`,
    },
    {
      label: `$(calendar) ${weeklyLabel}: ${formatPercent(snapshot.weekly.usagePercent)} · ${t?.statusBarReset(formatTime(snapshot.weekly.resetsInSeconds)) ?? `resets in ${formatTime(snapshot.weekly.resetsInSeconds)}`}`,
    },
    {
      label: `$(calendar) ${monthlyLabel}: ${formatPercent(snapshot.monthly.usagePercent)} · ${t?.statusBarReset(formatTime(snapshot.monthly.resetsInSeconds)) ?? `resets in ${formatTime(snapshot.monthly.resetsInSeconds)}`}`,
    },
    {
      label: prediction
        ? `$(trend-up) ${typeof predictionLabel === 'function' ? predictionLabel(prediction.toLocaleDateString()) : predictionLabel}`
        : `$(trend-up) ${noPredictionLabel}`,
    },
    {
      label: `$(list-unordered) ${typeof historyLabel === 'function' ? historyLabel(historyCount) : historyLabel}`,
    },
    {
      label: '$(link-external) Open OpenCode dashboard',
    },
    {
      label: '$(refresh) Force refresh',
    },
    {
      label: `$(gear) ${t?.detailsReconfigure ?? 'Reconfigure credentials'}`,
    },
    {
      label: `$(sign-out) ${t?.detailsLogout ?? 'Logout (Clear credentials)'}`,
    },
  ];

  return new Promise((resolve) => {
    let resolved = false;

    const acceptDisposable = qp.onDidAccept(() => {
      if (!resolved) {
        resolved = true;
        resolve(qp.selectedItems[0]?.label);
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

export async function showHistoryQuickPick(
  history: QuotaSnapshot[],
  createQuickPick: CreateQuickPick,
): Promise<string | undefined> {
  const qp = createQuickPick<QuickPickItem>();

  qp.items = history.map((entry) => {
    const date = new Date(entry.timestamp).toLocaleDateString();
    return {
      label: `${date} — Rolling: ${formatPercent(entry.rolling.usagePercent)} | Weekly: ${formatPercent(entry.weekly.usagePercent)} | Monthly: ${formatPercent(entry.monthly.usagePercent)}`,
    };
  });

  return new Promise((resolve) => {
    let resolved = false;

    const acceptDisposable = qp.onDidAccept(() => {
      if (!resolved) {
        resolved = true;
        resolve(qp.selectedItems[0]?.label);
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
