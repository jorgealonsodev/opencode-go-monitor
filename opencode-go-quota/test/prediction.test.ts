import { describe, it, expect } from 'vitest';
import { linearRegression, predictExhaustion } from '../src/domain/prediction';
import type { QuotaSnapshot } from '../src/domain/types';

function makeSnapshot(timestamp: number, monthlyUsage: number): QuotaSnapshot {
  return {
    timestamp,
    rolling: { status: 'ok', usagePercent: 10, resetsInSeconds: 3600 },
    weekly: { status: 'ok', usagePercent: 30, resetsInSeconds: 86400 },
    monthly: { status: 'ok', usagePercent: monthlyUsage, resetsInSeconds: 2592000 },
    source: 'api',
  };
}

describe('linearRegression', () => {
  it('returns zero values for empty array', () => {
    const result = linearRegression([]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(0);
    expect(result.r2).toBe(0);
  });

  it('returns zero values for single point', () => {
    const result = linearRegression([{ x: 1, y: 2 }]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(0);
    expect(result.r2).toBe(0);
  });

  it('calculates perfect linear fit', () => {
    // y = 2x + 1
    const points = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeCloseTo(2, 5);
    expect(result.intercept).toBeCloseTo(1, 5);
    expect(result.r2).toBeCloseTo(1, 5);
  });

  it('calculates approximate fit for noisy data', () => {
    // y ≈ 0.5x + 2
    const points = [
      { x: 0, y: 2 },
      { x: 1, y: 2.5 },
      { x: 2, y: 3.1 },
      { x: 3, y: 3.4 },
      { x: 4, y: 4.1 },
    ];
    const result = linearRegression(points);
    expect(result.slope).toBeCloseTo(0.5, 1);
    expect(result.intercept).toBeCloseTo(2, 1);
    expect(result.r2).toBeGreaterThan(0.95);
  });

  it('handles vertical line (zero denominator) gracefully', () => {
    const points = [
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 3 },
    ];
    const result = linearRegression(points);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(2);
  });
});

describe('predictExhaustion', () => {
  it('returns null for insufficient snapshots', () => {
    const now = Date.now();
    const snapshots = [
      makeSnapshot(now - 3600000, 50),
      makeSnapshot(now - 1800000, 55),
    ];
    expect(predictExhaustion(snapshots)).toBeNull();
  });

  it('returns null for flat usage (slope <= 0)', () => {
    const now = Date.now();
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      makeSnapshot(now - (9 - i) * 3600000, 50)
    );
    expect(predictExhaustion(snapshots)).toBeNull();
  });

  it('returns null for decreasing usage', () => {
    const now = Date.now();
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      makeSnapshot(now - (9 - i) * 3600000, 80 - i * 2)
    );
    expect(predictExhaustion(snapshots)).toBeNull();
  });

  it('predicts exhaustion for increasing usage', () => {
    const now = Date.now();
    // Usage increases 5% every hour, starting at 50%
    // y = 50 + 5 * (hours since start)
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      makeSnapshot(now - (9 - i) * 3600000, 50 + i * 5)
    );
    const prediction = predictExhaustion(snapshots);
    expect(prediction).not.toBeNull();
    expect(prediction!.getTime()).toBeGreaterThan(now);
  });

  it('returns null if snapshots are older than 24h', () => {
    const now = Date.now();
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      makeSnapshot(now - 25 * 3600000 - (9 - i) * 3600000, 50 + i * 5)
    );
    expect(predictExhaustion(snapshots)).toBeNull();
  });

  it('respects custom minSnapshots', () => {
    const now = Date.now();
    const snapshots = Array.from({ length: 5 }, (_, i) =>
      makeSnapshot(now - (4 - i) * 3600000, 50 + i * 5)
    );
    expect(predictExhaustion(snapshots, 6)).toBeNull();
    expect(predictExhaustion(snapshots, 5)).not.toBeNull();
  });

  it('returns null if exhaustion is in the past', () => {
    const now = Date.now();
    // Usage already at 100%
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      makeSnapshot(now - (9 - i) * 3600000, 95 + i * 1)
    );
    expect(predictExhaustion(snapshots)).toBeNull();
  });
});
