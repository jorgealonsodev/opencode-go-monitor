import type { QuotaSnapshot, QuotaWindow, StatusBarState } from '../domain/types';
import { formatTime, formatPercent } from '../domain/format';
import type { Translations } from '../i18n';
import { ADD_API_KEY_COMMAND, SELECT_API_KEY_COMMAND } from '../commands/apiKeys';

export interface ThemeColor {
  id: string;
}

export interface StatusBarItem {
  text: string;
  /** A string is plain text; an object is markdown, trusted only for the listed commands. */
  tooltip: string | MarkdownTooltip | undefined;
  command: string | undefined;
  color: string | ThemeColor | undefined;
  backgroundColor: string | ThemeColor | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface MarkdownTooltip {
  value: string;
  isTrusted?: boolean | { enabledCommands: readonly string[] };
}

export type StatusBarItemFactory = (alignment: number, priority: number) => StatusBarItem;

function createProgressBar(percent: number, length: number = 20): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/** Shown for a window whose data could not be read. */
const UNKNOWN_PERCENT = '?%';
/** Status bar prefix length (code points) when two or more profiles exist. */
const MAX_STATUS_BAR_NAME = 12;
const ERROR_COLOR = '#f14c4c';
const WARNING_COLOR = '#cca700';

/** Escapes CommonMark punctuation so user text renders literally in a trusted tooltip. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, '\\$&');
}

/** First 12 code points (trailing space trimmed) plus `…` for longer names. */
export function truncateProfileName(name: string): string {
  const codePoints = Array.from(name);
  if (codePoints.length <= MAX_STATUS_BAR_NAME) {
    return name;
  }
  return `${codePoints.slice(0, MAX_STATUS_BAR_NAME).join('').trimEnd()}…`;
}

function isUnknown(window: QuotaWindow): boolean {
  return window.status !== 'ok' && window.status !== 'limit-reached';
}

export class StatusBarManager {
  private _item: StatusBarItem | undefined;
  private _state: StatusBarState | undefined;
  private profileName: string | undefined;
  private profileCount = 0;

  constructor(
    private readonly factory: StatusBarItemFactory,
    private readonly t: Translations,
  ) {}

  /** Last state shown (`active` after update()); drives the single-click action. */
  get state(): StatusBarState | undefined {
    return this._state;
  }

  create(): StatusBarItem {
    this._item = this.factory(2, 100); // Right = 2, priority = 100
    this._item.command = 'opencodeGoQuota.statusBarClick';
    this._item.tooltip = 'OpenCode Go Quota';
    this._item.show();
    return this._item;
  }

  /**
   * The monitored profile and how many profiles exist. Applied on the next
   * update()/setState(); the name is prefixed to the status bar text only
   * when two or more profiles exist.
   */
  setProfileName(name: string | undefined, profileCount: number): void {
    this.profileName = name;
    this.profileCount = profileCount;
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
    const label = this.windowLabel(displayWindow);
    const headerValue = isUnknown(window)
      ? UNKNOWN_PERCENT
      : window.status === 'limit-reached'
        ? this.t.statusBarLimit
        : formatPercent(window.usagePercent);
    const value = isUnknown(window) ? headerValue : `${headerValue} · ${formatTime(window.resetsInSeconds)}`;

    const lines = [this.t.statusBarTooltip(label, headerValue)];
    for (const name of ['rolling', 'weekly', 'monthly'] as const) {
      lines.push('', `**${this.windowLabel(name)}**`, this.windowLine(snapshot[name]));
    }
    lines.push('', '---', this.footer(snapshot.timestamp));
    if (this.profileCount >= 2) {
      lines.push('', `[${this.t.statusBarSwitchApiKey}](command:${SELECT_API_KEY_COMMAND})`);
    }

    this._state = 'active';
    this._item.text =
      this.profileCount >= 2 && this.profileName
        ? this.t.statusBarTextWithProfile(truncateProfileName(this.profileName), label, value)
        : this.t.statusBarText(label, value);
    this._item.tooltip = { value: lines.join('\n'), isTrusted: { enabledCommands: [SELECT_API_KEY_COMMAND] } };
    this._item.command = 'opencodeGoQuota.statusBarClick';

    // Color reflects the WORST scenario among all windows (limit-reached counts as 100%)
    const maxPercent = Math.max(
      snapshot.rolling.usagePercent,
      snapshot.weekly.usagePercent,
      snapshot.monthly.usagePercent
    );
    if (maxPercent >= thresholds.error) {
      this._item.color = ERROR_COLOR;
    } else if (maxPercent >= thresholds.warning) {
      this._item.color = WARNING_COLOR;
    } else {
      this._item.color = undefined;
    }
    this._item.backgroundColor = undefined;
  }

  private windowLabel(window: 'rolling' | 'weekly' | 'monthly'): string {
    return window === 'rolling' ? this.t.statusBarRolling : window === 'weekly' ? this.t.statusBarWeekly : this.t.statusBarMonthly;
  }

  private windowLine(window: QuotaWindow): string {
    if (isUnknown(window)) {
      return `\`${UNKNOWN_PERCENT}\``;
    }
    const bar = createProgressBar(window.usagePercent);
    const reset = formatTime(window.resetsInSeconds);
    if (window.status === 'limit-reached') {
      return `${bar} ${this.t.statusBarLimitReached(reset)}`;
    }
    return `${bar} \`${formatPercent(window.usagePercent)}\` (${this.t.statusBarReset(reset)})`;
  }

  private footer(timestamp: number): string {
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return this.profileName
      ? this.t.statusBarFooter(escapeMarkdown(this.profileName), time)
      : this.t.statusBarUpdated(time);
  }

  /** Non-active states; `detail` is the error reason shown in the `error` tooltip. */
  setState(state: StatusBarState, detail?: string): void {
    if (!this._item) {
      return;
    }
    if (state !== 'active') {
      this._state = state;
    }

    // Tooltips below are plain strings (never trusted markdown), so names render literally.
    switch (state) {
      case 'setup':
        this._item.text = this.t.stateSetup;
        this._item.color = undefined;
        this._item.backgroundColor = undefined;
        this._item.tooltip = this.t.tooltipSetup;
        break;
      case 'loading':
        this._item.text = this.t.stateLoading;
        this._item.color = undefined;
        this._item.backgroundColor = undefined;
        this._item.tooltip = 'OpenCode Go Quota';
        break;
      case 'auth':
        this._item.text = this.t.stateInvalidKey;
        this._item.color = ERROR_COLOR;
        this._item.backgroundColor = undefined;
        this._item.tooltip = this.t.tooltipInvalidKey(this.profileName ?? '');
        break;
      case 'error':
        this._item.text = this.t.stateError;
        this._item.color = ERROR_COLOR;
        this._item.backgroundColor = undefined;
        this._item.tooltip = detail ?? 'OpenCode Go Quota';
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

/** Command run by a single status bar click for the given state (FR3). */
export function singleClickCommand(state: StatusBarState | undefined): string {
  switch (state) {
    case 'setup':
      return ADD_API_KEY_COMMAND;
    case 'auth':
      return SELECT_API_KEY_COMMAND;
    default:
      return 'opencodeGoQuota.refresh';
  }
}
