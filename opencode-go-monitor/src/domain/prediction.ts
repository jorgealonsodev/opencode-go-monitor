import type { QuotaSnapshot } from './types';

export interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
}

export function linearRegression(points: { x: number; y: number }[]): RegressionResult {
  const n = points.length;
  if (n < 2) {
    return { slope: 0, intercept: 0, r2: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumX2 += point.x * point.x;
    sumY2 += point.y * point.y;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return { slope: 0, intercept: sumY / n, r2: 0 };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R²
  const ssTot = sumY2 - (sumY * sumY) / n;
  const ssRes = sumY2 - 2 * intercept * sumY - 2 * slope * sumXY +
    n * intercept * intercept + 2 * intercept * slope * sumX + slope * slope * sumX2;

  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, r2 };
}

export function predictExhaustion(
  snapshots: QuotaSnapshot[],
  minSnapshots = 6
): Date | null {
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

  const recentSnapshots = snapshots
    .filter((s) => s.timestamp >= twentyFourHoursAgo)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (recentSnapshots.length < minSnapshots) {
    return null;
  }

  const points = recentSnapshots.map((s) => ({
    x: s.timestamp,
    y: s.monthly.usagePercent,
  }));

  const regression = linearRegression(points);

  if (regression.slope <= 0) {
    return null;
  }

  // Solve for x when y = 100: 100 = slope * x + intercept
  // x = (100 - intercept) / slope
  const exhaustionTime = (100 - regression.intercept) / regression.slope;

  if (exhaustionTime <= now) {
    return null;
  }

  return new Date(exhaustionTime);
}
