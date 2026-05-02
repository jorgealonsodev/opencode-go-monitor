import type { QuotaSnapshot, QuotaWindow, StatusBarState } from '../domain/types';
import { formatTime, formatPercent } from '../domain/format';
import type { Translations } from '../i18n';

export interface ThemeColor {
  id: string;
}

export interface StatusBarItem {
  text: string;
  tooltip: string | { value: string; isTrusted?: boolean } | undefined;
  command: string | undefined;
  color: string | ThemeColor | undefined;
  backgroundColor: string | ThemeColor | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export type StatusBarItemFactory = (alignment: number, priority: number) => StatusBarItem;

function createProgressBar(percent: number, length: number = 20): string {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export class StatusBarManager {
  private _item: StatusBarItem | undefined;

  constructor(
    private readonly factory: StatusBarItemFactory,
    private readonly t: Translations,
  ) {}

  create(): StatusBarItem {
    this._item = this.factory(2, 100); // Right = 2, priority = 100
    this._item.command = 'opencodeGoQuota.statusBarClick';
    this._item.tooltip = 'OpenCode Go Quota';
    this._item.show();
    return this._item;
  }

  update(
    snapshot: QuotaSnapshot,
    thresholds: { warning: number; error: number },
    displayWindow: 'rolling' | 'weekly' | 'monthly' = 'rolling',
  ): void {
    if (!this._item) {
      return;
    }

    const window = snapshot[displayWindow];
    const labelKey = displayWindow === 'rolling' ? 'statusBarRolling' : displayWindow === 'weekly' ? 'statusBarWeekly' : 'statusBarMonthly';
    const label = this.t[labelKey];
    const pct = formatPercent(window.usagePercent);
    const reset = formatTime(window.resetsInSeconds);

    // Build rich tooltip with progress bars for all windows
    const rollingBar = createProgressBar(snapshot.rolling.usagePercent);
    const weeklyBar = createProgressBar(snapshot.weekly.usagePercent);
    const monthlyBar = createProgressBar(snapshot.monthly.usagePercent);

    const rollingLabel = this.t.statusBarRolling;
    const weeklyLabel = this.t.statusBarWeekly;
    const monthlyLabel = this.t.statusBarMonthly;

    const tooltip = [
      this.t.statusBarTooltip(label, pct),
      '',
      `**${rollingLabel}**`,
      `${rollingBar} \`${snapshot.rolling.usagePercent}%\` (${this.t.statusBarReset(formatTime(snapshot.rolling.resetsInSeconds))})`,
      '',
      `**${weeklyLabel}**`,
      `${weeklyBar} \`${snapshot.weekly.usagePercent}%\` (${this.t.statusBarReset(formatTime(snapshot.weekly.resetsInSeconds))})`,
      '',
      `**${monthlyLabel}**`,
      `${monthlyBar} \`${snapshot.monthly.usagePercent}%\` (${this.t.statusBarReset(formatTime(snapshot.monthly.resetsInSeconds))})`,
      '',
      `---`,
      `${this.t.statusBarSource(snapshot.source)} | ${this.t.statusBarUpdated(new Date(snapshot.timestamp).toLocaleTimeString())}`,
    ].join('\n');

    this._item.text = this.t.statusBarText(label, pct, reset);
    this._item.tooltip = tooltip;
    this._item.command = 'opencodeGoQuota.statusBarClick';

    // Color reflects the WORST scenario among all windows
    const maxPercent = Math.max(
      snapshot.rolling.usagePercent,
      snapshot.weekly.usagePercent,
      snapshot.monthly.usagePercent
    );
    if (maxPercent >= thresholds.error) {
      this._item.color = '#f14c4c';
      this._item.backgroundColor = undefined;
    } else if (maxPercent >= thresholds.warning) {
      this._item.color = '#cca700';
      this._item.backgroundColor = undefined;
    } else {
      this._item.color = undefined;
      this._item.backgroundColor = undefined;
    }
  }

  setState(state: StatusBarState): void {
    if (!this._item) {
      return;
    }

    switch (state) {
      case 'setup':
        this._item.text = this.t.stateSetup;
        this._item.color = undefined;
        this._item.backgroundColor = undefined;
        this._item.tooltip = 'OpenCode Go Quota';
        break;
      case 'loading':
        this._item.text = this.t.stateLoading;
        this._item.color = undefined;
        this._item.backgroundColor = undefined;
        this._item.tooltip = 'OpenCode Go Quota';
        break;
      case 'auth':
        this._item.text = this.t.stateAuthExpired;
        this._item.color = '#f14c4c';
        this._item.backgroundColor = undefined;
        this._item.tooltip = 'OpenCode Go Quota';
        break;
      case 'error':
        this._item.text = this.t.stateError;
        this._item.color = '#f14c4c';
        this._item.backgroundColor = undefined;
        this._item.tooltip = 'OpenCode Go Quota';
        break;
      case 'active':
        // Handled by update()
        break;
    }
  }

  dispose(): void {
    this._item?.dispose();
    this._item = undefined;
  }

  get item(): StatusBarItem | undefined {
    return this._item;
  }
}
