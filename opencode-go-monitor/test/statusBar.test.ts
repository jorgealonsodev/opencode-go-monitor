import { describe, it, expect, vi } from 'vitest';
import {
  StatusBarManager,
  escapeMarkdown,
  singleClickCommand,
  truncateProfileName,
  type StatusBarItem,
  type StatusBarItemFactory,
} from '../src/ui/statusBar';
import type { QuotaSnapshot, QuotaWindow } from '../src/domain/types';
import { getTranslations } from '../src/i18n';

const en = getTranslations('en');
const es = getTranslations('es');
const THRESHOLDS = { warning: 80, error: 95 };

function createMockItem(): StatusBarItem {
  return {
    text: '',
    tooltip: '',
    command: undefined,
    color: undefined,
    backgroundColor: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

function setup(t = en): { manager: StatusBarManager; item: StatusBarItem; factory: StatusBarItemFactory } {
  const item = createMockItem();
  const factory = vi.fn(() => item);
  const manager = new StatusBarManager(factory, t);
  manager.create();
  return { manager, item, factory };
}

function win(usagePercent: number, resetsInSeconds: number, status: QuotaWindow['status'] = 'ok'): QuotaWindow {
  return { status, usagePercent, resetsInSeconds };
}

function makeSnapshot(usagePercent: number): QuotaSnapshot {
  return {
    timestamp: new Date(2026, 9, 11, 12, 4, 30).getTime(),
    rolling: win(usagePercent, 2 * 3600 + 13 * 60),
    weekly: win(usagePercent, 86400),
    monthly: win(usagePercent, 2592000),
    profileId: 'p1',
  };
}

/** Markdown of a rich tooltip, or the plain string. */
function tooltipText(item: StatusBarItem): string {
  const tooltip = item.tooltip;
  return typeof tooltip === 'object' && tooltip ? tooltip.value : String(tooltip);
}

describe('StatusBarManager', () => {
  describe('create', () => {
    it('creates item with right alignment and priority 100', () => {
      const { item, factory, manager } = setup();
      expect(factory).toHaveBeenCalledWith(2, 100);
      expect(manager.item).toBe(item);
      expect(item.command).toBe('opencodeGoQuota.statusBarClick');
      expect(item.show).toHaveBeenCalled();
    });

    it('exposes item via getter only after create', () => {
      const manager = new StatusBarManager(vi.fn(() => createMockItem()), en);
      expect(manager.item).toBeUndefined();
    });
  });

  describe('active, one profile', () => {
    it('keeps the unchanged status bar format', () => {
      const { manager, item } = setup();
      manager.setProfileName('Personal', 1);
      manager.update(makeSnapshot(42), THRESHOLDS);

      expect(item.text).toBe('OC Go Rolling: 42% · 2h 13m');
      expect(manager.state).toBe('active');
      expect(item.command).toBe('opencodeGoQuota.statusBarClick');
    });

    it('renders per-window lines and the key/updated footer in a trusted tooltip', () => {
      const { manager, item } = setup();
      manager.setProfileName('Personal', 1);
      manager.update(makeSnapshot(42), THRESHOLDS);

      expect(item.tooltip).toMatchObject({ isTrusted: { enabledCommands: ['opencodeGoQuota.selectApiKey'] } });
      const text = tooltipText(item);
      expect(text).toContain('`42%` (resets in 2h 13m)');
      expect(text).toContain('**Weekly**');
      expect(text).toContain('**Monthly**');
      expect(text).toMatch(/Key: Personal \| Updated \d{1,2}:\d{2}/);
      expect(text).not.toContain('Switch API key');
      expect(text).not.toContain('Workspace');
      expect(text).not.toContain('Source');
    });

    it('uses the displayed window label', () => {
      const { manager, item } = setup();
      manager.setProfileName('Personal', 1);
      manager.update(makeSnapshot(42), THRESHOLDS, 'weekly');
      expect(item.text).toBe('OC Go Weekly: 42% · 1d 0h');
    });
  });

  describe('active, two or more profiles', () => {
    it('prefixes the profile name and links Switch API key', () => {
      const { manager, item } = setup();
      manager.setProfileName('Team 1', 2);
      manager.update(makeSnapshot(42), THRESHOLDS);

      expect(item.text).toBe('OC Go · Team 1 · Rolling: 42% · 2h 13m');
      const text = tooltipText(item);
      expect(text).toContain('Key: Team 1 | Updated');
      expect(text).toContain('[Switch API key](command:opencodeGoQuota.selectApiKey)');
    });

    it('truncates names longer than 12 code points with an ellipsis', () => {
      const { manager, item } = setup();
      manager.setProfileName('Engineering Platform', 3);
      manager.update(makeSnapshot(42), THRESHOLDS);
      expect(item.text).toBe('OC Go · Engineering… · Rolling: 42% · 2h 13m');
    });

    it('truncates by code points, not UTF-16 units', () => {
      expect(truncateProfileName('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀')).toBe('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀…');
      expect(truncateProfileName('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀')).toBe('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');
      expect(truncateProfileName('Twelve chars')).toBe('Twelve chars');
    });
  });

  describe('limit reached (R3-limit-reached-unproved)', () => {
    it('shows `limit` instead of the percent, stays active and uses the error color', () => {
      const { manager, item } = setup();
      manager.setProfileName('Personal', 1);
      const snapshot = makeSnapshot(42);
      snapshot.rolling = win(100, 2 * 3600 + 13 * 60, 'limit-reached');
      manager.update(snapshot, THRESHOLDS);

      expect(item.text).toBe('OC Go Rolling: limit · 2h 13m');
      expect(manager.state).toBe('active');
      expect(singleClickCommand(manager.state)).toBe('opencodeGoQuota.refresh');
      expect(item.color).toBe('#f14c4c');
      expect(tooltipText(item)).toContain('Limit reached — resets in 2h 13m');
    });

    it('shows the limit line only on the limited window', () => {
      const { manager, item } = setup();
      manager.setProfileName('Personal', 1);
      const snapshot = makeSnapshot(42);
      snapshot.weekly = win(100, 3600, 'limit-reached');
      manager.update(snapshot, THRESHOLDS);

      expect(item.text).toBe('OC Go Rolling: 42% · 2h 13m');
      const text = tooltipText(item);
      expect(text).toContain('Limit reached — resets in 1h 0m');
      expect(text.match(/Limit reached/g)).toHaveLength(1);
    });

    it('uses the error color even when a limit-reached window reports a low percent', () => {
      const { manager, item } = setup();
      manager.setProfileName('Personal', 1);
      const snapshot = makeSnapshot(10);
      snapshot.weekly = win(40, 3600, 'limit-reached');
      manager.update(snapshot, THRESHOLDS);
      expect(item.color).toBe('#f14c4c');
    });

    it('is localized in Spanish', () => {
      const { manager, item } = setup(es);
      manager.setProfileName('Personal', 1);
      const snapshot = makeSnapshot(42);
      snapshot.rolling = win(100, 3600, 'limit-reached');
      manager.update(snapshot, THRESHOLDS);
      expect(item.text).toBe(`OC Go ${es.statusBarRolling}: ${es.statusBarLimit} · 1h 0m`);
      expect(tooltipText(item)).toContain(es.statusBarLimitReached('1h 0m'));
    });
  });

  describe('unknown windows', () => {
    it('render `?%` without a reset time', () => {
      const { manager, item } = setup();
      manager.setProfileName('Personal', 1);
      const snapshot = makeSnapshot(42);
      snapshot.rolling = win(0, 0, 'unknown');
      manager.update(snapshot, THRESHOLDS);

      expect(item.text).toBe('OC Go Rolling: ?%');
      const text = tooltipText(item);
      expect(text).toContain('`?%`');
      expect(text.split('\n').find((l) => l.includes('?%'))).not.toContain('resets');
    });
  });

  describe('markdown escaping (PRD §9)', () => {
    it('escapes the profile name before inserting it into the trusted tooltip', () => {
      const { manager, item } = setup();
      manager.setProfileName('**Acme** _x_ `y` <b>', 2);
      manager.update(makeSnapshot(42), THRESHOLDS);

      const text = tooltipText(item);
      expect(text).toContain('Key: \\*\\*Acme\\*\\* \\_x\\_ \\`y\\` \\<b\\> |');
      expect(text).not.toContain('**Acme**');
    });

    it('escapes markdown punctuation', () => {
      expect(escapeMarkdown('a*b_c`d\\e#f|g<h>i!j.k-l+m~n')).toBe(
        'a\\*b\\_c\\`d\\\\e\\#f\\|g\\<h\\>i\\!j\\.k\\-l\\+m\\~n',
      );
    });
  });

  describe('colors (max percent across windows)', () => {
    it.each([
      [50, undefined],
      [80, '#cca700'],
      [90, '#cca700'],
      [95, '#f14c4c'],
      [100, '#f14c4c'],
    ])('at %i%% uses %s', (pct, color) => {
      const { manager, item } = setup();
      manager.update(makeSnapshot(pct), THRESHOLDS);
      expect(item.color).toBe(color);
      expect(item.backgroundColor).toBeUndefined();
    });

    it('uses the worst window even when another is displayed', () => {
      const { manager, item } = setup();
      const snapshot = makeSnapshot(10);
      snapshot.monthly = win(96, 60);
      manager.update(snapshot, THRESHOLDS);
      expect(item.color).toBe('#f14c4c');
    });
  });

  describe('setState', () => {
    it('setup: add API key text and tooltip', () => {
      const { manager, item } = setup();
      manager.setState('setup');
      expect(item.text).toBe('OC Go: add API key');
      expect(item.tooltip).toBe('No OpenCode Go API key configured. Click to add one.');
      expect(item.color).toBeUndefined();
      expect(singleClickCommand(manager.state)).toBe('opencodeGoQuota.configure');
    });

    it('auth: invalid key text and a tooltip naming the profile', () => {
      const { manager, item } = setup();
      manager.setProfileName('Team 1', 2);
      manager.setState('auth');
      expect(item.text).toBe('OC Go: invalid key');
      expect(item.tooltip).toBe("API key 'Team 1' was rejected (401/403). Click to choose another key.");
      expect(item.color).toBe('#f14c4c');
      expect(singleClickCommand(manager.state)).toBe('opencodeGoQuota.selectApiKey');
    });

    it('auth tooltip without a known profile name does not render empty quotes', () => {
      const { manager, item } = setup();
      manager.setState('auth');
      expect(item.tooltip).toBe('The active API key was rejected (401/403). Click to choose another key.');
    });

    it('auth tooltip is plain text, so a markdown-looking name stays inert', () => {
      const { manager, item } = setup();
      manager.setProfileName('**bold**', 1);
      manager.setState('auth');
      expect(typeof item.tooltip).toBe('string');
    });

    it('error: unchanged text and the reason as tooltip', () => {
      const { manager, item } = setup();
      manager.setState('error', 'Request timed out');
      expect(item.text).toBe('OC Go: error');
      expect(item.tooltip).toBe('Request timed out');
      expect(item.color).toBe('#f14c4c');
      expect(singleClickCommand(manager.state)).toBe('opencodeGoQuota.refresh');
    });

    it('loading', () => {
      const { manager, item } = setup();
      manager.setState('loading');
      expect(item.text).toBe(en.stateLoading);
    });

    it('Spanish strings', () => {
      const { manager, item } = setup(es);
      manager.setState('setup');
      expect(item.text).toBe('OC Go: añadir clave de API');
      manager.setProfileName('Equipo', 1);
      manager.setState('auth');
      expect(item.text).toBe('OC Go: clave no válida');
      expect(item.tooltip).toBe("Se rechazó la clave de API 'Equipo' (401/403). Haz clic para elegir otra clave.");
    });

    it('active is a no-op (update() renders it)', () => {
      const { manager, item } = setup();
      manager.setState('setup');
      manager.setState('active');
      expect(item.text).toBe('OC Go: add API key');
    });

    it('does nothing before create', () => {
      const manager = new StatusBarManager(vi.fn(() => createMockItem()), en);
      manager.setState('setup');
      manager.update(makeSnapshot(50), THRESHOLDS);
      expect(manager.state).toBeUndefined();
    });
  });

  describe('dispose', () => {
    it('disposes the item and clears the reference', () => {
      const { manager, item } = setup();
      manager.dispose();
      expect(item.dispose).toHaveBeenCalled();
      expect(manager.item).toBeUndefined();
      manager.dispose();
    });
  });

  describe('single click', () => {
    it('tracks the shown state', () => {
      const { manager } = setup();
      manager.setState('auth');
      expect(manager.state).toBe('auth');
      manager.update(makeSnapshot(10), THRESHOLDS);
      expect(manager.state).toBe('active');
    });

    it('adds a key in setup, selects a key in auth, and refreshes otherwise', () => {
      expect(singleClickCommand('setup')).toBe('opencodeGoQuota.configure');
      expect(singleClickCommand('auth')).toBe('opencodeGoQuota.selectApiKey');
      expect(singleClickCommand('active')).toBe('opencodeGoQuota.refresh');
      expect(singleClickCommand('error')).toBe('opencodeGoQuota.refresh');
      expect(singleClickCommand(undefined)).toBe('opencodeGoQuota.refresh');
    });
  });
});
