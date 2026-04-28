export interface SecretStorageLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

const AUTH_COOKIE_KEY = 'opencodeGoQuota.authCookie';
const WORKSPACE_ID_KEY = 'opencodeGoQuota.workspaceId';
const COOKIE_TIMESTAMP_KEY = 'opencodeGoQuota.cookieTimestamp';

export class CredentialsStorage {
  private _cachedCredentials: { authCookie: string; workspaceId: string } | null | undefined = undefined;

  constructor(private readonly secretStorage: SecretStorageLike) {}

  async saveCredentials(authCookie: string, workspaceId: string): Promise<void> {
    // SECURITY: Store directly in SecretStorage (OS keychain encryption)
    // No additional obfuscation needed - VSCode SecretStorage already uses
    // macOS Keychain, Windows Credential Manager, or Linux Secret Service
    await Promise.all([
      this.secretStorage.store(AUTH_COOKIE_KEY, authCookie),
      this.secretStorage.store(WORKSPACE_ID_KEY, workspaceId),
      this.secretStorage.store(COOKIE_TIMESTAMP_KEY, Date.now().toString()),
    ]);
    this._cachedCredentials = { authCookie, workspaceId };
    if (typeof globalThis.opencodeGoQuotaDebug === 'function') {
      globalThis.opencodeGoQuotaDebug('[Credentials] saveCredentials: cache updated');
    }
  }

  async getCredentials(): Promise<{ authCookie: string; workspaceId: string } | null> {
    if (this._cachedCredentials !== undefined) {
      if (typeof globalThis.opencodeGoQuotaDebug === 'function') {
        globalThis.opencodeGoQuotaDebug(`[Credentials] getCredentials: cache hit (present=${this._cachedCredentials !== null})`);
      }
      return this._cachedCredentials;
    }

    const authCookie = await this.secretStorage.get(AUTH_COOKIE_KEY);
    const workspaceId = await this.secretStorage.get(WORKSPACE_ID_KEY);

    // Debug logging to diagnose missing credentials
    if (typeof globalThis.opencodeGoQuotaDebug === 'function') {
      globalThis.opencodeGoQuotaDebug(`[Credentials] getCredentials: cache miss, authCookie=${authCookie ? 'present' : 'missing'}, workspaceId=${workspaceId ? 'present' : 'missing'}`);
    }

    if (!authCookie || !workspaceId) {
      this._cachedCredentials = null;
      return null;
    }

    this._cachedCredentials = { authCookie, workspaceId };
    return this._cachedCredentials;
  }

  async clearCredentials(): Promise<void> {
    await Promise.all([
      this.secretStorage.delete(AUTH_COOKIE_KEY),
      this.secretStorage.delete(WORKSPACE_ID_KEY),
      this.secretStorage.delete(COOKIE_TIMESTAMP_KEY),
    ]);
    this._cachedCredentials = null;
    if (typeof globalThis.opencodeGoQuotaDebug === 'function') {
      globalThis.opencodeGoQuotaDebug('[Credentials] clearCredentials: cache cleared');
    }
  }

  async hasCredentials(): Promise<boolean> {
    const creds = await this.getCredentials();
    return creds !== null;
  }

  async getCredentialAge(): Promise<number | null> {
    const timestamp = await this.secretStorage.get(COOKIE_TIMESTAMP_KEY);
    if (!timestamp) {
      return null;
    }
    return Date.now() - parseInt(timestamp, 10);
  }

  maskCookie(cookie: string): string {
    // SECURITY: Never reveal any part of the auth cookie in debug output
    return `[${cookie.length} chars]`;
  }
}
