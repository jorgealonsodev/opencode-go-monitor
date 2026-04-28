import { describe, it, expect, vi } from 'vitest';
import { StatusBarManager, type StatusBarItem, type StatusBarItemFactory } from '../src/ui/statusBar';
import type { QuotaSnapshot } from '../src/domain/types';

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

describe('StatusBarManager', () => {
  describe('create', () => {
    it('creates item with right alignment and priority 100', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      const result = manager.create();

      expect(factory).toHaveBeenCalledWith(2, 100);
      expect(result).toBe(item);
      expect(item.command).toBe('opencodeGoQuota.showDetails');
      expect(item.tooltip).toBe('OpenCode Go Quota');
      expect(item.show).toHaveBeenCalled();
    });

    it('exposes item via getter', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      expect(manager.item).toBeUndefined();
      manager.create();
      expect(manager.item).toBe(item);
    });
  });

  describe('update', () => {
    it('sets text with worst window percentage and reset time', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
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
      expect(item.tooltip).toBe('OpenCode Go Quota');
      expect(item.command).toBe('opencodeGoQuota.showDetails');
    });

    it('sets no color when below warning threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.update(makeSnapshot(50), { warning: 80, error: 95 });

      expect(item.color).toBeUndefined();
    });

    it('sets warning color when at warning threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.update(makeSnapshot(80), { warning: 80, error: 95 });

      expect(item.color).toEqual({ id: 'statusBarItem.warningBackground' });
    });

    it('sets warning color between warning and error', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.update(makeSnapshot(90), { warning: 80, error: 95 });

      expect(item.color).toEqual({ id: 'statusBarItem.warningBackground' });
    });

    it('sets error color when at error threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.update(makeSnapshot(95), { warning: 80, error: 95 });

      expect(item.color).toEqual({ id: 'statusBarItem.errorBackground' });
    });

    it('sets error color above error threshold', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.update(makeSnapshot(100), { warning: 80, error: 95 });

      expect(item.color).toEqual({ id: 'statusBarItem.errorBackground' });
    });

    it('does nothing when item has not been created', () => {
      const manager = new StatusBarManager(createMockFactory().factory);
      // Should not throw
      manager.update(makeSnapshot(50), { warning: 80, error: 95 });
    });
  });

  describe('setState', () => {
    it('sets setup state', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.setState('setup');

      expect(item.text).toBe('$(gear) OC Go: setup');
      expect(item.color).toBeUndefined();
    });

    it('sets loading state', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.setState('loading');

      expect(item.text).toBe('$(loading~spin) OC Go: loading...');
      expect(item.color).toBeUndefined();
    });

    it('sets auth state with error color', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.setState('auth');

      expect(item.text).toBe('$(warning) OC Go: auth expired');
      expect(item.color).toEqual({ id: 'statusBarItem.errorBackground' });
    });

    it('sets error state with error color', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.setState('error');

      expect(item.text).toBe('$(warning) OC Go: error');
      expect(item.color).toEqual({ id: 'statusBarItem.errorBackground' });
    });

    it('active state does not change text', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.setState('setup');
      manager.setState('active');

      // active is a no-op in setState; caller should call update() next
      expect(item.text).toBe('$(gear) OC Go: setup');
    });

    it('does nothing when item has not been created', () => {
      const manager = new StatusBarManager(createMockFactory().factory);
      manager.setState('setup');
      // Should not throw
    });
  });

  describe('dispose', () => {
    it('disposes the item and clears the reference', () => {
      const { factory, item } = createMockFactory();
      const manager = new StatusBarManager(factory);
      manager.create();
      manager.dispose();

      expect(item.dispose).toHaveBeenCalled();
      expect(manager.item).toBeUndefined();
    });

    it('is safe to call when item is undefined', () => {
      const manager = new StatusBarManager(createMockFactory().factory);
      manager.dispose();
      // Should not throw
    });
  });
});
