import { describe, it, expect, vi } from 'vitest';
import { StatusBarManager, type StatusBarItem, type StatusBarItemFactory } from '../src/ui/statusBar';
import type { QuotaSnapshot } from '../src/domain/types';
import type { Translations } from '../src/i18n';

function createMockItem(): StatusBarItem {
  return {
    text: '',
    tooltip: '',
    command: undefined,
    color: undefined,
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
    source: 'api',
  };
}

function createMockTranslations(): Translations {
  return {
    statusBarTooltip: () => 'OpenCode Go',
    statusBarText: () => '$(graph) OC Go: 50% · 1d 0h',
    statusBarRolling: 'Rolling',
    statusBarWeekly: 'Weekly',
    statusBarMonthly: 'Monthly',
    statusBarReset: (time) => `resets in ${time}`,
    statusBarSource: (source) => `Source: ${source}`,
    statusBarUpdated: (time) => `Updated: ${time}`,
    stateSetup: '$(gear) OC Go: setup',
    stateLoading: '$(loading~spin) OC Go: loading...',
    stateAuthExpired: '$(warning) OC Go: auth expired',
    stateError: '$(warning) OC Go: error',
    cmdConfigureTitle: '',
    cmdRefreshTitle: '',
    cmdShowDetailsTitle: '',
    cmdExportHistoryTitle: '',
    cmdOpenDashboardTitle: '',
    cmdClearCredentialsTitle: '',
    cmdSelectDisplayWindowTitle: '',
    msgCredentialsSaved: () => '',
    msgCredentialsRequired: '',
    msgFailedToSave: () => '',
    msgQuotaRefreshed: () => '',
    msgFailedToRefresh: () => '',
    msgNoDataAvailable: '',
    msgRefreshNow: '',
    msgConfigureCredentials: '',
    msgWindowChanged: () => '',
    msgHistoryExported: () => '',
    msgFailedToExport: () => '',
    msgCredentialsCleared: '',
    promptWorkspaceId: '',
    promptWorkspaceIdPlaceholder: '',
    promptAuthCookie: '',
    promptAuthCookiePlaceholder: '',
    pickDisplayWindowPlaceholder: '',
    pickRollingLabel: '',
    pickRollingDesc: '',
    pickWeeklyLabel: '',
    pickWeeklyDesc: '',
    pickMonthlyLabel: '',
    pickMonthlyDesc: '',
    pickCurrent: '',
    detailsTitle: '',
    detailsRolling: '',
    detailsWeekly: '',
    detailsMonthly: '',
    detailsPrediction: () => '',
    detailsNoPrediction: '',
    detailsHistoryCount: () => '',
    detailsReconfigure: '',
    detailsLogout: '',
    errCredentialsNotFound: '',
    errParseFailed: '',
    errNetworkFailed: '',
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
        source: 'api',
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
    });

    it('sets warning color when at warning threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(80), { warning: 80, error: 95 });

      expect(item.color).toEqual({ id: 'statusBarItem.warningBackground' });
    });

    it('sets warning color between warning and error', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(90), { warning: 80, error: 95 });

      expect(item.color).toEqual({ id: 'statusBarItem.warningBackground' });
    });

    it('sets error color when at error threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(95), { warning: 80, error: 95 });

      expect(item.color).toEqual({ id: 'statusBarItem.errorBackground' });
    });

    it('sets error color above error threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.update(makeSnapshot(100), { warning: 80, error: 95 });

      expect(item.color).toEqual({ id: 'statusBarItem.errorBackground' });
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
      expect(item.color).toBeUndefined();
    });

    it('sets loading state', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.setState('loading');

      expect(item.text).toBe('$(loading~spin) OC Go: loading...');
      expect(item.color).toBeUndefined();
    });

    it('sets auth state with error color', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.setState('auth');

      expect(item.text).toBe('$(warning) OC Go: auth expired');
      expect(item.color).toEqual({ id: 'statusBarItem.errorBackground' });
    });

    it('sets error state with error color', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory, createMockTranslations());
      manager.create();
      manager.setState('error');

      expect(item.text).toBe('$(warning) OC Go: error');
      expect(item.color).toEqual({ id: 'statusBarItem.errorBackground' });
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
});
