export interface SecretStorageLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

const AUTH_COOKIE_KEY = 'opencodeGoQuota.authCookie';
const WORKSPACE_ID_KEY = 'opencodeGoQuota.workspaceId';
const COOKIE_TIMESTAMP_KEY = 'opencodeGoQuota.cookieTimestamp';

export class CredentialsStorage {
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
  }

  async getCredentials(): Promise<{ authCookie: string; workspaceId: string } | null> {
    const authCookie = await this.secretStorage.get(AUTH_COOKIE_KEY);
    const workspaceId = await this.secretStorage.get(WORKSPACE_ID_KEY);

    if (!authCookie || !workspaceId) {
      return null;
    }

    return { authCookie, workspaceId };
  }

  async clearCredentials(): Promise<void> {
    await Promise.all([
      this.secretStorage.delete(AUTH_COOKIE_KEY),
      this.secretStorage.delete(WORKSPACE_ID_KEY),
      this.secretStorage.delete(COOKIE_TIMESTAMP_KEY),
    ]);
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
