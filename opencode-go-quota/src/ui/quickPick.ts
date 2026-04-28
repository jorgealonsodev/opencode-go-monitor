import type { QuotaSnapshot } from '../domain/types';
import { formatTime, formatPercent } from '../domain/format';

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
): Promise<string | undefined> {
  const qp = createQuickPick<QuickPickItem>();

  qp.items = [
    {
      label: `$(clock) Rolling: ${formatPercent(snapshot.rolling.usagePercent)} · resets in ${formatTime(snapshot.rolling.resetsInSeconds)}`,
    },
    {
      label: `$(calendar) Weekly: ${formatPercent(snapshot.weekly.usagePercent)} · resets in ${formatTime(snapshot.weekly.resetsInSeconds)}`,
    },
    {
      label: `$(calendar) Monthly: ${formatPercent(snapshot.monthly.usagePercent)} · resets in ${formatTime(snapshot.monthly.resetsInSeconds)}`,
    },
    {
      label: prediction
        ? `$(trend-up) Predicted exhaustion: ${prediction.toLocaleDateString()}`
        : '$(trend-up) Predicted exhaustion: Insufficient data',
    },
    {
      label: `$(list-unordered) View history (${historyCount} entries)`,
    },
    {
      label: '$(link-external) Open OpenCode dashboard',
    },
    {
      label: '$(refresh) Force refresh',
    },
    {
      label: '$(gear) Reconfigure credentials',
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
