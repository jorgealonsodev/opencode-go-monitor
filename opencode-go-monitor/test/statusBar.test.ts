import { describe, it, expect, vi } from 'vitest';
import { StatusBarManager, singleClickCommand, type StatusBarItem, type StatusBarItemFactory } from '../src/ui/statusBar';
import type { QuotaSnapshot } from '../src/domain/types';
import { getTranslations, type Translations } from '../src/i18n';

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

function createMockFactory(item = createMockItem()): { factory: StatusBarItemFactory; item: StatusBarItem } {
  const factory = vi.fn(() => item);
  return { factory, item };
}

function makeSnapshot(usagePercent: number): QuotaSnapshot {
  return {
    timestamp: Date.now(),
    rolling: { status: 'ok', usagePercent, resetsInSeconds: 3600 },
    weekly: { status: 'ok', usagePercent, resetsInSeconds: 86400 },
    monthly: { status: 'ok', usagePercent, resetsInSeconds: 2592000 },
    profileId: 'default',
  };
}

function createMockTranslations(): Translations {
  return {
    ...getTranslations('en'),
    statusBarTooltip: () => 'OpenCode Go',
    statusBarText: () => '$(graph) OC Go: 50% · 1d 0h',
    stateSetup: '$(gear) OC Go: setup',
    stateLoading: '$(loading~spin) OC Go: loading...',
    stateAuthExpired: '$(warning) OC Go: auth expired',
    stateError: '$(warning) OC Go: error',
  };
}

describe('StatusBarManager', () => {
  describe('create', () => {
    it('creates item with right alignment and priority 100', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      const result = manager.create();

      expect(factory).toHaveBeenCalledWith(2, 100);
      expect(result).toBe(item);
      expect(item.command).toBe('opencodeGoQuota.statusBarClick');
      expect(item.tooltip).toBe('OpenCode Go Quota');
      expect(item.show).toHaveBeenCalled();
    });

    it('exposes item via getter', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      expect(manager.item).toBeUndefined();
      manager.create();
      expect(manager.item).toBe(item);
    });
  });

  describe('update', () => {
    it('sets text with worst window percentage and reset time', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();

      const snapshot: QuotaSnapshot = {
        timestamp: Date.now(),
        rolling: { status: 'ok', usagePercent: 10, resetsInSeconds: 3600 },
        weekly: { status: 'ok', usagePercent: 50, resetsInSeconds: 86400 },
        monthly: { status: 'ok', usagePercent: 30, resetsInSeconds: 2592000 },
        profileId: 'default',
      };

      manager.update(snapshot, { warning: 80, error: 95 });

      expect(item.text).toBe('$(graph) OC Go: 50% · 1d 0h');
      expect(item.tooltip).toContain('OpenCode Go');
      expect(item.command).toBe('opencodeGoQuota.statusBarClick');
    });

    it('sets no color when below warning threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(50), { warning: 80, error: 95 });

      expect(item.color).toBeUndefined();
      expect(item.backgroundColor).toBeUndefined();
    });

    it('has no workspace or source lines in the tooltip', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(50), { warning: 80, error: 95 });

      expect(item.tooltip as string).not.toContain('Workspace');
      expect(item.tooltip as string).toContain('Updated: ');
    });

    it('sets warning color when at warning threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(80), { warning: 80, error: 95 });

      expect(item.color).toBe('#cca700');
      expect(item.backgroundColor).toBeUndefined();
    });

    it('sets warning color between warning and error', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(90), { warning: 80, error: 95 });

      expect(item.color).toBe('#cca700');
      expect(item.backgroundColor).toBeUndefined();
    });

    it('sets error color when at error threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(95), { warning: 80, error: 95 });

      expect(item.color).toBe('#f14c4c');
      expect(item.backgroundColor).toBeUndefined();
    });

    it('sets error color above error threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(100), { warning: 80, error: 95 });

      expect(item.color).toBe('#f14c4c');
      expect(item.backgroundColor).toBeUndefined();
    });

    it('does nothing when item has not been created', () => {
      const manager = new StatusBarManager(createMockFactory().factory, createMockTranslations());
      // Should not throw
      manager.update(makeSnapshot(50), { warning: 80, error: 95 });
    });
  });

  describe('setState', () => {
    it('sets setup state', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.setState('setup');

      expect(item.text).toBe('$(gear) OC Go: setup');
      expect(item.backgroundColor).toBeUndefined();
    });

    it('sets loading state', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.setState('loading');

      expect(item.text).toBe('$(loading~spin) OC Go: loading...');
      expect(item.backgroundColor).toBeUndefined();
    });

    it('sets auth state with error color', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.setState('auth');

      expect(item.text).toBe('$(warning) OC Go: auth expired');
      expect(item.color).toBe('#f14c4c');
      expect(item.backgroundColor).toBeUndefined();
    });

    it('sets error state with error color', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.setState('error');

      expect(item.text).toBe('$(warning) OC Go: error');
      expect(item.color).toBe('#f14c4c');
      expect(item.backgroundColor).toBeUndefined();
    });

    it('active state does not change text', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.setState('setup');
      manager.setState('active');

      // active is a no-op in setState; caller should call update() next
      expect(item.text).toBe('$(gear) OC Go: setup');
    });

    it('does nothing when item has not been created', () => {
      const manager = new StatusBarManager(createMockFactory().factory, createMockTranslations());
      manager.setState('setup');
      // Should not throw
    });
  });

  describe('dispose', () => {
    it('disposes the item and clears the reference', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.dispose();

      expect(item.dispose).toHaveBeenCalled();
      expect(manager.item).toBeUndefined();
    });

    it('is safe to call when item is undefined', () => {
      const manager = new StatusBarManager(createMockFactory().factory, createMockTranslations());
      manager.dispose();
      // Should not throw
    });
  });

  describe('single click', () => {
    it('tracks the shown state', () => {
      const { factory } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.setState('auth');
      expect(manager.state).toBe('auth');
      manager.update(makeSnapshot(10), { warning: 80, error: 95 });
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
