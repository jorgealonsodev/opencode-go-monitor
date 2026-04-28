import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialsStorage } from '../src/storage/credentials';
import type { SecretStorageLike, WorkspaceConfigurationLike } from '../src/storage/credentials';

function createMockSecretStorage(): SecretStorageLike {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key)) as SecretStorageLike['get'],
    store: vi.fn(async (key: string, value: string) => { store.set(key, value); }) as SecretStorageLike['store'],
    delete: vi.fn(async (key: string) => { store.delete(key); }) as SecretStorageLike['delete'],
  };
}

function createMockConfig(): WorkspaceConfigurationLike {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => store.get(key) ?? defaultValue) as WorkspaceConfigurationLike['get'],
    update: vi.fn(async (key: string, value: unknown, _global?: boolean) => { store.set(key, value); }) as WorkspaceConfigurationLike['update'],
  };
}

describe('CredentialsStorage', () => {
  let secrets: SecretStorageLike;
  let config: WorkspaceConfigurationLike;
  let storage: CredentialsStorage;

  beforeEach(() => {
    secrets = createMockSecretStorage();
    config = createMockConfig();
    storage = new CredentialsStorage(secrets, config);
  });

  describe('saveCredentials', () => {
    it('stores authCookie in secret storage and workspaceId in config', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      expect(secrets.store).toHaveBeenCalledWith('opencodeGoQuota.authCookie', 'secret1234');
      expect(config.update).toHaveBeenCalledWith('opencodeGoQuota.workspaceId', 'ws-abc');
    });
  });

  describe('getCredentials', () => {
    it('returns credentials when both are present', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      const creds = await storage.getCredentials();
      expect(creds).toEqual({ authCookie: 'secret1234', workspaceId: 'ws-abc' });
    });

    it('returns null when authCookie is missing', async () => {
      await config.update('opencodeGoQuota.workspaceId', 'ws-abc');
      const creds = await storage.getCredentials();
      expect(creds).toBeNull();
    });

    it('returns null when workspaceId is missing', async () => {
      await secrets.store('opencodeGoQuota.authCookie', 'secret1234');
      const creds = await storage.getCredentials();
      expect(creds).toBeNull();
    });
  });

  describe('clearCredentials', () => {
    it('removes both credentials', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      await storage.clearCredentials();
      expect(secrets.delete).toHaveBeenCalledWith('opencodeGoQuota.authCookie');
      expect(config.update).toHaveBeenCalledWith('opencodeGoQuota.workspaceId', undefined);
      expect(await storage.getCredentials()).toBeNull();
    });
  });

  describe('hasCredentials', () => {
    it('returns true when both credentials exist', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      expect(await storage.hasCredentials()).toBe(true);
    });

    it('returns false when a credential is missing', async () => {
      expect(await storage.hasCredentials()).toBe(false);
    });
  });

  describe('maskCookie', () => {
    it('masks all but the last 4 characters', () => {
      expect(storage.maskCookie('my_secret_xyz9')).toBe('**********xyz9');
      expect(storage.maskCookie('12345678')).toBe('****5678');
    });

    it('returns all asterisks for short cookies', () => {
      expect(storage.maskCookie('abc')).toBe('***');
      expect(storage.maskCookie('')).toBe('');
    });
  });
});
