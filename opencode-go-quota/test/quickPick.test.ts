import { describe, it, expect } from 'vitest';
import {
  showDetailQuickPick,
  showHistoryQuickPick,
  type QuickPickItem,
  type QuickPick,
  type CreateQuickPick,
} from '../src/ui/quickPick';
import type { QuotaSnapshot } from '../src/domain/types';

function createMockQuickPick<T extends QuickPickItem>(): QuickPick<T> & {
  _fireAccept: () => void;
  _fireHide: () => void;
} {
  const listeners = {
    accept: [] as Array<() => void>,
    hide: [] as Array<() => void>,
  };

  const qp = {
    items: [] as T[],
    selectedItems: [] as readonly T[],
    onDidAccept: (listener: () => void) => {
      listeners.accept.push(listener);
      return { dispose: () => { listeners.accept = listeners.accept.filter(l => l !== listener); } };
    },
    onDidHide: (listener: () => void) => {
      listeners.hide.push(listener);
      return { dispose: () => { listeners.hide = listeners.hide.filter(l => l !== listener); } };
    },
    show: () => {
      // no-op for tests
    },
    hide: () => {
      listeners.hide.forEach(l => l());
    },
    dispose: () => {
      // no-op for tests
    },
    _fireAccept: () => {
      listeners.accept.forEach(l => l());
    },
    _fireHide: () => {
      listeners.hide.forEach(l => l());
    },
  };

  return qp as unknown as QuickPick<T> & { _fireAccept: () => void; _fireHide: () => void };
}

function createMockFactory(): { factory: CreateQuickPick; qp: QuickPick<QuickPickItem> & { _fireAccept: () => void; _fireHide: () => void } } {
  const qp = createMockQuickPick<QuickPickItem>();
  return {
    factory: (() => qp) as unknown as CreateQuickPick,
    qp,
  };
}

function makeSnapshot(timestamp: number): QuotaSnapshot {
  return {
    timestamp,
    rolling: { status: 'ok', usagePercent: 10, resetsInSeconds: 3600 },
    weekly: { status: 'ok', usagePercent: 50, resetsInSeconds: 86400 },
    monthly: { status: 'ok', usagePercent: 30, resetsInSeconds: 2592000 },
    source: 'api',
  };
}

describe('showDetailQuickPick', () => {
  it('returns selected label when user accepts', async () => {
    const { factory, qp } = createMockFactory();
    const promise = showDetailQuickPick(makeSnapshot(Date.now()), null, 5, factory);

    qp.selectedItems = [{ label: '$(refresh) Force refresh' }];
    qp._fireAccept();

    const result = await promise;
    expect(result).toBe('$(refresh) Force refresh');
  });

  it('returns undefined when user hides without selection', async () => {
    const { factory, qp } = createMockFactory();
    const promise = showDetailQuickPick(makeSnapshot(Date.now()), null, 5, factory);

    qp._fireHide();

    const result = await promise;
    expect(result).toBeUndefined();
  });

  it('generates correct items with all data', async () => {
    const { factory, qp } = createMockFactory();
    const snapshot = makeSnapshot(Date.now());
    const prediction = new Date('2025-12-25');

    const promise = showDetailQuickPick(snapshot, prediction, 42, factory);

    expect(qp.items).toHaveLength(8);
    expect(qp.items[0].label).toBe('$(clock) Rolling: 10% · resets in 1h 0m');
    expect(qp.items[1].label).toBe('$(calendar) Weekly: 50% · resets in 1d 0h');
    expect(qp.items[2].label).toBe('$(calendar) Monthly: 30% · resets in 30d 0h');
    expect(qp.items[3].label).toContain('Predicted exhaustion');
    expect(qp.items[3].label).toContain('2025');
    expect(qp.items[4].label).toBe('$(list-unordered) View history (42 entries)');
    expect(qp.items[5].label).toBe('$(link-external) Open OpenCode dashboard');
    expect(qp.items[6].label).toBe('$(refresh) Force refresh');
    expect(qp.items[7].label).toBe('$(gear) Reconfigure credentials');

    qp._fireHide();
    await promise;
  });

  it('shows insufficient data when prediction is null', async () => {
    const { factory, qp } = createMockFactory();
    const snapshot = makeSnapshot(Date.now());

    const promise = showDetailQuickPick(snapshot, null, 0, factory);

    expect(qp.items[3].label).toBe('$(trend-up) Predicted exhaustion: Insufficient data');

    qp._fireHide();
    await promise;
  });
});

describe('showHistoryQuickPick', () => {
  it('returns selected label when user accepts', async () => {
    const { factory, qp } = createMockFactory();
    const history = [makeSnapshot(Date.now())];
    const promise = showHistoryQuickPick(history, factory);

    qp.selectedItems = [{ label: qp.items[0].label }];
    qp._fireAccept();

    const result = await promise;
    expect(result).toContain('Rolling: 10%');
  });

  it('returns undefined when user hides without selection', async () => {
    const { factory, qp } = createMockFactory();
    const history = [makeSnapshot(Date.now())];
    const promise = showHistoryQuickPick(history, factory);

    qp._fireHide();

    const result = await promise;
    expect(result).toBeUndefined();
  });

  it('generates correct labels for history entries', async () => {
    const { factory, qp } = createMockFactory();
    const history: QuotaSnapshot[] = [
      {
        timestamp: new Date('2025-06-15T10:00:00Z').getTime(),
        rolling: { status: 'ok', usagePercent: 15, resetsInSeconds: 3600 },
        weekly: { status: 'ok', usagePercent: 55, resetsInSeconds: 86400 },
        monthly: { status: 'ok', usagePercent: 35, resetsInSeconds: 2592000 },
        source: 'api',
      },
    ];

    const promise = showHistoryQuickPick(history, factory);

    expect(qp.items).toHaveLength(1);
    expect(qp.items[0].label).toContain('Rolling: 15%');
    expect(qp.items[0].label).toContain('Weekly: 55%');
    expect(qp.items[0].label).toContain('Monthly: 35%');

    qp._fireHide();
    await promise;
  });

  it('handles empty history', async () => {
    const { factory, qp } = createMockFactory();
    const promise = showHistoryQuickPick([], factory);

    expect(qp.items).toHaveLength(0);

    qp._fireHide();
    await promise;
  });
});
