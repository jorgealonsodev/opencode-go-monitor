import type { QuotaSnapshot, StatusBarState } from '../domain/types';
import { formatTime, formatPercent, getWorstWindow } from '../domain/format';

export interface ThemeColor {
  id: string;
}

export interface StatusBarItem {
  text: string;
  tooltip: string;
  command: string | undefined;
  color: string | ThemeColor | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export type StatusBarItemFactory = (alignment: number, priority: number) => StatusBarItem;

export class StatusBarManager {
  private _item: StatusBarItem | undefined;

  constructor(private readonly factory: StatusBarItemFactory) {}

  create(): StatusBarItem {
    this._item = this.factory(2, 100); // Right = 2, priority = 100
    this._item.command = 'opencodeGoQuota.showDetails';
    this._item.tooltip = 'OpenCode Go Quota';
    this._item.show();
    return this._item;
  }

  update(
    snapshot: QuotaSnapshot,
    thresholds: { warning: number; error: number },
  ): void {
    if (!this._item) {
      return;
    }

    const worst = getWorstWindow(snapshot);
    const pct = formatPercent(worst.usagePercent);
    const reset = formatTime(worst.resetsInSeconds);

    this._item.text = `$(graph) OC Go: ${pct} · ${reset}`;
    this._item.tooltip = 'OpenCode Go Quota';
    this._item.command = 'opencodeGoQuota.showDetails';

    if (worst.usagePercent >= thresholds.error) {
      this._item.color = { id: 'statusBarItem.errorBackground' };
    } else if (worst.usagePercent >= thresholds.warning) {
      this._item.color = { id: 'statusBarItem.warningBackground' };
    } else {
      this._item.color = undefined;
    }
  }

  setState(state: StatusBarState): void {
    if (!this._item) {
      return;
    }

    switch (state) {
      case 'setup':
        this._item.text = '$(gear) OC Go: setup';
        this._item.color = undefined;
        this._item.tooltip = 'OpenCode Go Quota';
        break;
      case 'loading':
        this._item.text = '$(loading~spin) OC Go: loading...';
        this._item.color = undefined;
        this._item.tooltip = 'OpenCode Go Quota';
        break;
      case 'auth':
        this._item.text = '$(warning) OC Go: auth expired';
        this._item.color = { id: 'statusBarItem.errorBackground' };
        this._item.tooltip = 'OpenCode Go Quota';
        break;
      case 'error':
        this._item.text = '$(warning) OC Go: error';
        this._item.color = { id: 'statusBarItem.errorBackground' };
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
