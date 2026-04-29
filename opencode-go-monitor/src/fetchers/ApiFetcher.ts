import type { QuotaFetcher, QuotaSnapshot } from '../domain/types';
import { CredentialsError, NetworkError } from '../domain/errors';
import type { CredentialsStorage } from '../storage/credentials';
import type { FetchFn } from './ScrapingFetcher';

const debug = (msg: string) => {
  if (typeof globalThis.opencodeGoQuotaDebug === 'function') {
    globalThis.opencodeGoQuotaDebug(msg);
  }
};

export class ApiFetcher implements QuotaFetcher {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly credentials: CredentialsStorage,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async fetch(): Promise<QuotaSnapshot> {
    debug('[ApiFetcher] === fetch started ===');
    
    const creds = await this.credentials.getCredentials();
    if (!creds) {
      debug('[ApiFetcher] no credentials found');
      throw new CredentialsError();
    }

    debug(`[ApiFetcher] workspaceId: ${creds.workspaceId}`);
    debug(`[ApiFetcher] authCookie length: ${creds.authCookie.length}`);
    debug(`[ApiFetcher] authCookie (masked): ${this.credentials.maskCookie(creds.authCookie)}`);

    // Cookie header must include the name 'auth='
    const cookieHeader = creds.authCookie.startsWith('auth=') 
      ? creds.authCookie 
      : `auth=${creds.authCookie}`;

    const url = 'https://console.opencode.ai/zen/go/v1/usage';
    debug(`[ApiFetcher] URL: ${url}`);
    
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: {
          Cookie: cookieHeader,
        },
      });
    } catch (err) {
      debug(`[ApiFetcher] network error: ${err instanceof Error ? err.message : String(err)}`);
      throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
    }

    debug(`[ApiFetcher] response status: ${response.status}`);
    debug(`[ApiFetcher] response ok: ${response.ok}`);
    // SECURITY: Only log safe header names, never values
    const safeHeaderNames = ['content-type', 'content-length', 'date', 'x-request-id'];
    const safeHeaders = Object.fromEntries(
      [...response.headers.entries()].filter(([k]) => safeHeaderNames.includes(k.toLowerCase()))
    );
    debug(`[ApiFetcher] response headers (safe): ${JSON.stringify(safeHeaders)}`);

    if (!response.ok) {
      debug(`[ApiFetcher] HTTP error: ${response.status}`);
      throw new NetworkError(`HTTP ${response.status}`, response.status);
    }

    const data = (await response.json()) as Record<string, unknown>;
    // SECURITY: Only log known-safe keys, never dump full response
    const safeKeys = ['rolling', 'weekly', 'monthly'];
    const safeData = Object.fromEntries(
      Object.entries(data).filter(([k]) => safeKeys.includes(k))
    );
    debug(`[ApiFetcher] response data keys: ${Object.keys(data).join(', ')}`);
    debug(`[ApiFetcher] response data (safe): ${JSON.stringify(safeData).substring(0, 100)}`);
    
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
