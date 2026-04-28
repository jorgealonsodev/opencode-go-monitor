import type { QuotaFetcher, QuotaSnapshot } from '../domain/types';
import { CredentialsError, NetworkError } from '../domain/errors';
import type { CredentialsStorage } from '../storage/credentials';
import type { FetchFn } from './ScrapingFetcher';

export class ApiFetcher implements QuotaFetcher {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly credentials: CredentialsStorage,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async fetch(): Promise<QuotaSnapshot> {
    const creds = await this.credentials.getCredentials();
    if (!creds) {
      throw new CredentialsError();
    }

    const url = 'https://console.opencode.ai/zen/go/v1/usage';
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: {
          Cookie: creds.authCookie,
        },
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
    }

    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}`, response.status);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.normalizeResponse(data);
  }

  async isAvailable(): Promise<boolean> {
    const creds = await this.credentials.getCredentials();
    if (!creds) {
      return false;
    }

    const url = 'https://console.opencode.ai/zen/go/v1/usage';
    try {
      const response = await this.fetchFn(url, {
        headers: {
          Cookie: creds.authCookie,
        },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private normalizeResponse(data: Record<string, unknown>): QuotaSnapshot {
    const extractWindow = (obj: unknown): { status: 'ok' | 'error' | 'unknown'; usagePercent: number; resetsInSeconds: number } => {
      if (!obj || typeof obj !== 'object') {
        return { status: 'unknown', usagePercent: 0, resetsInSeconds: 0 };
      }
      const o = obj as Record<string, unknown>;
      const status = typeof o.status === 'string' && (o.status === 'ok' || o.status === 'error') ? o.status : 'unknown';
      const usagePercent = typeof o.usagePercent === 'number' ? o.usagePercent : 0;
      const resetsInSeconds =
        typeof o.resetsInSeconds === 'number'
          ? o.resetsInSeconds
          : typeof o.resetInSec === 'number'
            ? o.resetInSec
            : 0;
      return { status, usagePercent, resetsInSeconds };
    };

    return {
      timestamp: Date.now(),
      rolling: extractWindow(data.rolling),
      weekly: extractWindow(data.weekly),
      monthly: extractWindow(data.monthly),
      source: 'api',
    };
  }
}
