export interface QuotaWindow {
  status: 'ok' | 'limit-reached' | 'error' | 'unknown';
  usagePercent: number; // 0..100
  resetsInSeconds: number; // seconds until reset
}

export interface QuotaSnapshot {
  timestamp: number; // ms epoch
  profileId: string; // profile active when the fetch started
  rolling: QuotaWindow;
  weekly: QuotaWindow;
  monthly: QuotaWindow;
}

export interface QuotaFetcher {
  fetch(): Promise<QuotaSnapshot>;
  isAvailable(): Promise<boolean>;
}

/** The API key currently selected for monitoring. */
export interface ActiveKey {
  id: string;
  name: string;
  key: string;
}

/** Port: supplies the active API key to fetchers without exposing UI or storage. */
export interface ActiveKeyProvider {
  getActive(): Promise<ActiveKey | null>;
}

export type StatusBarState = 'setup' | 'loading' | 'active' | 'auth' | 'error';
