import { describe, it, expect } from 'vitest';
import {
  showDetailQuickPick,
  type QuickPickItem,
  type QuickPick,
  type CreateQuickPick,
} from '../src/ui/quickPick';
import type { QuotaSnapshot } from '../src/domain/types';
import { getTranslations } from '../src/i18n';

const t = getTranslations('en');

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
    profileId: 'default',
  };
}

describe('showDetailQuickPick', () => {
  it('returns the action of the accepted item', async () => {
    const { factory, qp } = createMockFactory();
    const promise = showDetailQuickPick(makeSnapshot(Date.now()), null, 5, factory, t, 'Personal');

    qp.selectedItems = [qp.items.find((i) => i.label === `$(refresh) ${t.detailsForceRefresh}`)!];
    qp._fireAccept();

    expect(await promise).toBe('refresh');
  });

  it('returns undefined when user hides without selection', async () => {
    const { factory, qp } = createMockFactory();
    const promise = showDetailQuickPick(makeSnapshot(Date.now()), null, 5, factory, t, 'Personal');

    qp._fireHide();

    expect(await promise).toBeUndefined();
  });

  it('returns undefined for informational items', async () => {
    const { factory, qp } = createMockFactory();
    const promise = showDetailQuickPick(makeSnapshot(Date.now()), null, 5, factory, t, 'Personal');

    qp.selectedItems = [qp.items[0]];
    qp._fireAccept();

    expect(await promise).toBeUndefined();
  });

  it('lists windows, prediction, history and key-management actions', async () => {
    const { factory, qp } = createMockFactory();
    const snapshot = makeSnapshot(Date.now());
    const prediction = new Date('2025-12-25');

    const promise = showDetailQuickPick(snapshot, prediction, 42, factory, t, 'Team 1');

    expect(qp.items.map((i) => i.label)).toEqual([
      '$(clock) Rolling: 10% · resets in 1h 0m',
      '$(calendar) Weekly: 50% · resets in 1d 0h',
      '$(calendar) Monthly: 30% · resets in 30d 0h',
      `$(trend-up) ${t.detailsPrediction(prediction.toLocaleDateString())}`,
      '$(list-unordered) 42 snapshots in history',
      '$(link-external) Open OpenCode dashboard',
      '$(refresh) Force refresh',
      '$(key) Switch API key (Team 1)',
      '$(add) Add API Key',
      '$(trash) Remove All API Keys',
    ]);
    expect(qp.items.map((i) => (i as { action?: string }).action)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'openDashboard',
      'refresh',
      'switchApiKey',
      'addApiKey',
      'removeAllApiKeys',
    ]);
    expect(qp.items.some((i) => /Reconfigure|Logout/.test(i.label))).toBe(false);

    qp._fireHide();
    await promise;
  });

  it('omits Switch API key without an active profile', async () => {
    const { factory, qp } = createMockFactory();
    const promise = showDetailQuickPick(makeSnapshot(Date.now()), null, 0, factory, t, undefined);

    expect(qp.items.some((i) => i.label.includes('Switch API key'))).toBe(false);

    qp._fireHide();
    await promise;
  });

  it('shows the no-prediction label when prediction is null', async () => {
    const { factory, qp } = createMockFactory();
    const promise = showDetailQuickPick(makeSnapshot(Date.now()), null, 0, factory, t, 'Personal');

    expect(qp.items[3].label).toBe(`$(trend-up) ${t.detailsNoPrediction}`);

    qp._fireHide();
    await promise;
  });

  it('renders limit-reached and unknown windows', async () => {
    const { factory, qp } = createMockFactory();
    const snapshot = makeSnapshot(Date.now());
    snapshot.rolling = { status: 'limit-reached', usagePercent: 100, resetsInSeconds: 3600 };
    snapshot.weekly = { status: 'unknown', usagePercent: 0, resetsInSeconds: 0 };
    const promise = showDetailQuickPick(snapshot, null, 0, factory, t, 'Personal');

    expect(qp.items[0].label).toBe('$(clock) Rolling: Limit reached — resets in 1h 0m');
    expect(qp.items[1].label).toBe('$(calendar) Weekly: ?%');

    qp._fireHide();
    await promise;
  });
});
