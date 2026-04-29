import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CredentialsStorage } from '../src/storage/credentials';
import type { SecretStorageLike } from '../src/storage/credentials';

function createMockSecretStorage(): SecretStorageLike {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key)) as SecretStorageLike['get'],
    store: vi.fn(async (key: string, value: string) => { store.set(key, value); }) as SecretStorageLike['store'],
    delete: vi.fn(async (key: string) => { store.delete(key); }) as SecretStorageLike['delete'],
  };
}

describe('CredentialsStorage', () => {
  let secrets: SecretStorageLike;
  let storage: CredentialsStorage;
  const debugMessages: string[] = [];

  beforeEach(() => {
    secrets = createMockSecretStorage();
    storage = new CredentialsStorage(secrets);
    debugMessages.length = 0;
    (globalThis as any).opencodeGoQuotaDebug = (msg: string) => debugMessages.push(msg);
  });

  describe('saveCredentials', () => {
    it('stores authCookie and workspaceId in secret storage and updates cache', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      expect(secrets.store).toHaveBeenCalledWith('opencodeGoQuota.authCookie', 'secret1234');
      expect(secrets.store).toHaveBeenCalledWith('opencodeGoQuota.workspaceId', 'ws-abc');
      expect(secrets.store).toHaveBeenCalledWith('opencodeGoQuota.cookieTimestamp', expect.any(String));
      expect(debugMessages).toContain('[Credentials] saveCredentials: cache updated');
    });
  });

  describe('getCredentials', () => {
    it('returns credentials when both are present', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      const creds = await storage.getCredentials();
      expect(creds).toEqual({ authCookie: 'secret1234', workspaceId: 'ws-abc' });
    });

    it('returns null when authCookie is missing', async () => {
      await secrets.store('opencodeGoQuota.workspaceId', 'ws-abc');
      const creds = await storage.getCredentials();
      expect(creds).toBeNull();
    });

    it('returns null when workspaceId is missing', async () => {
      await secrets.store('opencodeGoQuota.authCookie', 'secret1234');
      const creds = await storage.getCredentials();
      expect(creds).toBeNull();
    });

    it('uses cache on subsequent calls without hitting secretStorage', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      // Reset mock to track further calls
      vi.mocked(secrets.get).mockClear();

      const creds1 = await storage.getCredentials();
      expect(creds1).toEqual({ authCookie: 'secret1234', workspaceId: 'ws-abc' });
      expect(secrets.get).not.toHaveBeenCalled();
      expect(debugMessages).toContain('[Credentials] getCredentials: cache hit (present=true)');

      const creds2 = await storage.getCredentials();
      expect(creds2).toEqual({ authCookie: 'secret1234', workspaceId: 'ws-abc' });
      expect(secrets.get).not.toHaveBeenCalled();
    });

    it('logs cache miss when fetching from secretStorage', async () => {
      await secrets.store('opencodeGoQuota.authCookie', 'secret1234');
      await secrets.store('opencodeGoQuota.workspaceId', 'ws-abc');
      const creds = await storage.getCredentials();
      expect(creds).toEqual({ authCookie: 'secret1234', workspaceId: 'ws-abc' });
      expect(debugMessages.some(m => m.includes('cache miss'))).toBe(true);
    });

    it('caches null result when credentials are missing', async () => {
      const creds1 = await storage.getCredentials();
      expect(creds1).toBeNull();
      vi.mocked(secrets.get).mockClear();

      const creds2 = await storage.getCredentials();
      expect(creds2).toBeNull();
      expect(secrets.get).not.toHaveBeenCalled();
      expect(debugMessages).toContain('[Credentials] getCredentials: cache hit (present=false)');
    });

    it('survives secretStorage returning undefined by using cache', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      // Simulate Linux keyring instability: secretStorage returns undefined
      vi.mocked(secrets.get).mockResolvedValue(undefined);

      const creds = await storage.getCredentials();
      expect(creds).toEqual({ authCookie: 'secret1234', workspaceId: 'ws-abc' });
      // Cache hit: secretStorage.get is NOT called, protecting against keyring instability
      expect(secrets.get).not.toHaveBeenCalled();
    });
  });

  describe('clearCredentials', () => {
    it('removes both credentials and clears cache', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      await storage.clearCredentials();
      expect(secrets.delete).toHaveBeenCalledWith('opencodeGoQuota.authCookie');
      expect(secrets.delete).toHaveBeenCalledWith('opencodeGoQuota.workspaceId');
      expect(secrets.delete).toHaveBeenCalledWith('opencodeGoQuota.cookieTimestamp');
      expect(debugMessages).toContain('[Credentials] clearCredentials: cache cleared');

      // After clearing, subsequent get should return null
      vi.mocked(secrets.get).mockResolvedValue(undefined);
      const creds = await storage.getCredentials();
      expect(creds).toBeNull();
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

    it('uses cache when available', async () => {
      await storage.saveCredentials('secret1234', 'ws-abc');
      vi.mocked(secrets.get).mockClear();
      expect(await storage.hasCredentials()).toBe(true);
      expect(secrets.get).not.toHaveBeenCalled();
    });
  });

  describe('maskCookie', () => {
    it('returns length-based mask', () => {
      expect(storage.maskCookie('my_secret_xyz9')).toBe('[14 chars]');
      expect(storage.maskCookie('12345678')).toBe('[8 chars]');
    });

    it('handles short cookies', () => {
      expect(storage.maskCookie('abc')).toBe('[3 chars]');
      expect(storage.maskCookie('')).toBe('[0 chars]');
    });
  });

  describe('getCredentialAge', () => {
    it('returns age in ms when timestamp exists', async () => {
      const now = Date.now();
      await secrets.store('opencodeGoQuota.cookieTimestamp', now.toString());
      const age = await storage.getCredentialAge();
      expect(age).not.toBeNull();
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(1000);
    });

    it('returns null when timestamp is missing', async () => {
      expect(await storage.getCredentialAge()).toBeNull();
    });
  });
});
