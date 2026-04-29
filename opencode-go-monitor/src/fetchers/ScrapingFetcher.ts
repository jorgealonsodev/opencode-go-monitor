import type { QuotaFetcher, QuotaSnapshot } from '../domain/types';
import { CredentialsError, ParseError, NetworkError } from '../domain/errors';
import type { CredentialsStorage } from '../storage/credentials';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const debug = (msg: string) => {
  if (typeof globalThis.opencodeGoQuotaDebug === 'function') {
    globalThis.opencodeGoQuotaDebug(msg);
  }
};

export class ScrapingFetcher implements QuotaFetcher {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly credentials: CredentialsStorage,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async fetch(): Promise<QuotaSnapshot> {
    debug('[ScrapingFetcher] === fetch started ===');
    
    const creds = await this.credentials.getCredentials();
    if (!creds) {
      debug('[ScrapingFetcher] no credentials found');
      throw new CredentialsError();
    }

    debug(`[ScrapingFetcher] workspaceId: ${creds.workspaceId}`);
    debug(`[ScrapingFetcher] authCookie length: ${creds.authCookie.length}`);

    const url = `https://opencode.ai/workspace/${creds.workspaceId}/go`;
    debug(`[ScrapingFetcher] URL: ${url}`);
    
    // Cookie header must include the name 'auth='
    const cookieHeader = creds.authCookie.startsWith('auth=') 
      ? creds.authCookie 
      : `auth=${creds.authCookie}`;
    
    // SECURITY: Never log any part of the actual cookie value
    debug(`[ScrapingFetcher] Cookie header: [${cookieHeader.length} chars]`);
    
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: {
          Cookie: cookieHeader,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          Referer: `https://opencode.ai/workspace/${creds.workspaceId}`,
        },
        redirect: 'follow',
      });
    } catch (err) {
      debug(`[ScrapingFetcher] network error: ${err instanceof Error ? err.message : String(err)}`);
      throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
    }

    debug(`[ScrapingFetcher] response status: ${response.status}`);
    debug(`[ScrapingFetcher] response ok: ${response.ok}`);
    debug(`[ScrapingFetcher] response url: ${response.url}`);
    debug(`[ScrapingFetcher] response redirected: ${response.redirected}`);

    if (!response.ok) {
      debug(`[ScrapingFetcher] HTTP error: ${response.status}`);
      throw new NetworkError(`HTTP ${response.status}`, response.status);
    }

    const html = await response.text();
    debug(`[ScrapingFetcher] HTML length: ${html.length}`);
    debug(`[ScrapingFetcher] HTML contains '<html>': ${html.includes('<html>')}`);
    debug(`[ScrapingFetcher] HTML contains 'rollingUsage': ${html.includes('rollingUsage')}`);
    debug(`[ScrapingFetcher] HTML contains 'usagePercent': ${html.includes('usagePercent')}`);
    
    // Log first 500 chars if parsing might fail
    if (!html.includes('rollingUsage') || !html.includes('usagePercent')) {
      debug(`[ScrapingFetcher] HTML snippet (first 500 chars): ${html.substring(0, 500)}`);
      debug(`[ScrapingFetcher] HTML snippet (last 200 chars): ${html.substring(Math.max(0, html.length - 200))}`);
    }

    const snapshot = this.parseHtml(html);
    debug(`[ScrapingFetcher] parse result: rolling=${snapshot.rolling.usagePercent}%, weekly=${snapshot.weekly.usagePercent}%, monthly=${snapshot.monthly.usagePercent}%`);
    return snapshot;
  }

  async isAvailable(): Promise<boolean> {
    return this.credentials.hasCredentials();
  }

  private parseHtml(html: string): QuotaSnapshot {
    // SolidJS SSR hydration format. Each usage window has its own $R reference:
    // rollingUsage:$R[30]={status:"ok",resetInSec:17562,usagePercent:1},weeklyUsage:$R[31]={status:"ok",resetInSec:533388,usagePercent:5},monthlyUsage:$R[32]={status:"ok",resetInSec:2485309,usagePercent:19}
    const extractWindow = (name: string): { status: 'ok' | 'error' | 'unknown'; resetsInSeconds: number; usagePercent: number } => {
      // Primary pattern: name:$R[\d+]={status:"...",resetInSec:\d+,usagePercent:\d+}
      let pattern = new RegExp(`${name}:\\$R\\[\\d+\\]=\\{status:"([^"]+)",resetInSec:(\\d+),usagePercent:(\\d+)\\}`);
      let match = pattern.exec(html);
      
      // Fallback: handle case where data might be inline without $R ref
      if (!match) {
        pattern = new RegExp(`${name}=\\{status:"([^"]+)",resetInSec:(\\d+),usagePercent:(\\d+)\\}`);
        match = pattern.exec(html);
      }

      if (!match) {
        debug(`[ScrapingFetcher] extractWindow('${name}'): no match`);
        return { status: 'unknown', resetsInSeconds: 0, usagePercent: 0 };
      }
      
      debug(`[ScrapingFetcher] extractWindow('${name}'): status=${match[1]}, resetInSec=${match[2]}, usagePercent=${match[3]}`);
      
      const toStatus = (s: string): 'ok' | 'error' | 'unknown' => {
        if (s === 'ok' || s === 'error') return s;
        return 'unknown';
      };
      return {
        status: toStatus(match[1]),
        resetsInSeconds: parseInt(match[2], 10),
        usagePercent: parseInt(match[3], 10),
      };
    };

    const rolling = extractWindow('rollingUsage');
    const weekly = extractWindow('weeklyUsage');
    const monthly = extractWindow('monthlyUsage');

    if (rolling.status === 'unknown' && weekly.status === 'unknown' && monthly.status === 'unknown') {
      debug('[ScrapingFetcher] ALL windows unknown - throwing ParseError');
      throw new ParseError(`Could not find quota usage data in HTML (length: ${html.length})`);
    }

    return {
      timestamp: Date.now(),
      rolling,
      weekly,
      monthly,
      source: 'scraping',
    };
  }
}
