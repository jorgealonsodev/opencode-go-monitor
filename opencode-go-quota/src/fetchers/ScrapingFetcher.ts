import type { QuotaFetcher, QuotaSnapshot } from '../domain/types';
import { CredentialsError, ParseError, NetworkError } from '../domain/errors';
import type { CredentialsStorage } from '../storage/credentials';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class ScrapingFetcher implements QuotaFetcher {
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

    const url = `https://opencode.ai/workspace/${creds.workspaceId}/go`;
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

    const html = await response.text();
    const snapshot = this.parseHtml(html);
    return snapshot;
  }

  async isAvailable(): Promise<boolean> {
    return this.credentials.hasCredentials();
  }

  private parseHtml(html: string): QuotaSnapshot {
    // Regex handles SolidJS SSR hydration blocks like:
    // rollingUsage:$R[26]={status:"ok",resetInSec:3471,usagePercent:29},
    // weeklyUsage:$R[27]={status:"ok",resetInSec:464797,usagePercent:11},
    // monthlyUsage:$R[28]={status:"ok",resetInSec:1811918,usagePercent:37}
    const pattern =
      /rollingUsage:\$R\[\d+\]=\{status:"([^"]+)",resetInSec:(\d+),usagePercent:(\d+)\},weeklyUsage:\$R\[\d+\]=\{status:"([^"]+)",resetInSec:(\d+),usagePercent:(\d+)\},monthlyUsage:\$R\[\d+\]=\{status:"([^"]+)",resetInSec:(\d+),usagePercent:(\d+)\}/;

    const match = pattern.exec(html);
    if (!match) {
      throw new ParseError('Could not find quota usage data in HTML');
    }

    const toStatus = (s: string): 'ok' | 'error' | 'unknown' => {
      if (s === 'ok' || s === 'error') return s;
      return 'unknown';
    };

    return {
      timestamp: Date.now(),
      rolling: {
        status: toStatus(match[1]),
        resetsInSeconds: parseInt(match[2], 10),
        usagePercent: parseInt(match[3], 10),
      },
      weekly: {
        status: toStatus(match[4]),
        resetsInSeconds: parseInt(match[5], 10),
        usagePercent: parseInt(match[6], 10),
      },
      monthly: {
        status: toStatus(match[7]),
        resetsInSeconds: parseInt(match[8], 10),
        usagePercent: parseInt(match[9], 10),
      },
      source: 'scraping',
    };
  }
}
