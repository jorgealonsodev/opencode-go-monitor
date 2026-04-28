export interface SecretStorageLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export interface WorkspaceConfigurationLike {
  get<T>(section: string, defaultValue?: T): T | undefined;
  update(section: string, value: any, global?: boolean): Thenable<void>;
}

const AUTH_COOKIE_KEY = 'opencodeGoQuota.authCookie';
const WORKSPACE_ID_KEY = 'opencodeGoQuota.workspaceId';

export class CredentialsStorage {
  constructor(
    private readonly secretStorage: SecretStorageLike,
    private readonly config: WorkspaceConfigurationLike,
  ) {}

  async saveCredentials(authCookie: string, workspaceId: string): Promise<void> {
    await Promise.all([
      this.secretStorage.store(AUTH_COOKIE_KEY, authCookie),
      this.config.update(WORKSPACE_ID_KEY, workspaceId),
    ]);
  }

  async getCredentials(): Promise<{ authCookie: string; workspaceId: string } | null> {
    const authCookie = await this.secretStorage.get(AUTH_COOKIE_KEY);
    const workspaceId = this.config.get<string>(WORKSPACE_ID_KEY);

    if (!authCookie || !workspaceId) {
      return null;
    }

    return { authCookie, workspaceId };
  }

  async clearCredentials(): Promise<void> {
    await Promise.all([
      this.secretStorage.delete(AUTH_COOKIE_KEY),
      this.config.update(WORKSPACE_ID_KEY, undefined),
    ]);
  }

  async hasCredentials(): Promise<boolean> {
    const creds = await this.getCredentials();
    return creds !== null;
  }

  maskCookie(cookie: string): string {
    if (cookie.length <= 4) {
      return '*'.repeat(cookie.length);
    }
    return '*'.repeat(cookie.length - 4) + cookie.slice(-4);
  }
}
