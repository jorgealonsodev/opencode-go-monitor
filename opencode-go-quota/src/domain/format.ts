import type { QuotaSnapshot, QuotaWindow } from './types';

export function formatTime(seconds: number): string {
  if (seconds < 0) {
    seconds = 0;
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export function formatPercent(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  return `${Math.round(clamped)}%`;
}

export function getWorstWindow(snapshot: QuotaSnapshot): QuotaWindow {
  const windows: QuotaWindow[] = [snapshot.rolling, snapshot.weekly, snapshot.monthly];
  return windows.reduce((worst, current) =>
    current.usagePercent > worst.usagePercent ? current : worst
  );
}
