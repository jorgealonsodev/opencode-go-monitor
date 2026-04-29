import { describe, it, expect } from 'vitest';
import { formatTime, formatPercent, getWorstWindow } from '../src/domain/format';
import type { QuotaSnapshot } from '../src/domain/types';

describe('formatTime', () => {
  it('formats minutes only', () => {
    expect(formatTime(42 * 60)).toBe('42m');
    expect(formatTime(59 * 60)).toBe('59m');
  });

  it('formats hours and minutes', () => {
    expect(formatTime(4 * 3600 + 12 * 60)).toBe('4h 12m');
    expect(formatTime(1 * 3600 + 0 * 60)).toBe('1h 0m');
    expect(formatTime(23 * 3600 + 59 * 60)).toBe('23h 59m');
  });

  it('formats days and hours', () => {
    expect(formatTime(2 * 86400 + 4 * 3600)).toBe('2d 4h');
    expect(formatTime(1 * 86400 + 0 * 3600)).toBe('1d 0h');
    expect(formatTime(5 * 86400 + 12 * 3600)).toBe('5d 12h');
  });

  it('handles zero seconds', () => {
    expect(formatTime(0)).toBe('0m');
  });

  it('handles negative seconds', () => {
    expect(formatTime(-100)).toBe('0m');
  });
});

describe('formatPercent', () => {
  it('formats a percentage', () => {
    expect(formatPercent(65)).toBe('65%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(100)).toBe('100%');
  });

  it('clamps below 0 to 0', () => {
    expect(formatPercent(-10)).toBe('0%');
  });

  it('clamps above 100 to 100', () => {
    expect(formatPercent(150)).toBe('100%');
  });

  it('rounds to nearest integer', () => {
    expect(formatPercent(65.4)).toBe('65%');
    expect(formatPercent(65.6)).toBe('66%');
  });
});

describe('getWorstWindow', () => {
  it('returns the window with highest usagePercent', () => {
    const snapshot: QuotaSnapshot = {
      timestamp: Date.now(),
      rolling: { status: 'ok', usagePercent: 10, resetsInSeconds: 3600 },
      weekly: { status: 'ok', usagePercent: 50, resetsInSeconds: 86400 },
      monthly: { status: 'ok', usagePercent: 30, resetsInSeconds: 2592000 },
      source: 'api',
    };

    expect(getWorstWindow(snapshot)).toBe(snapshot.weekly);
  });

  it('returns rolling when all are equal', () => {
    const snapshot: QuotaSnapshot = {
      timestamp: Date.now(),
      rolling: { status: 'ok', usagePercent: 50, resetsInSeconds: 3600 },
      weekly: { status: 'ok', usagePercent: 50, resetsInSeconds: 86400 },
      monthly: { status: 'ok', usagePercent: 50, resetsInSeconds: 2592000 },
      source: 'api',
    };

    expect(getWorstWindow(snapshot)).toBe(snapshot.rolling);
  });
});
