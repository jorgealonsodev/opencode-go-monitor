import { vi } from 'vitest';
import type { MementoLike } from '../src/storage/history';
import type { SecretStorageLike } from '../src/storage/profiles';

/** In-memory globalState fake; `undefined` deletes like VS Code's Memento. */
export function createMemento(initial: Record<string, unknown> = {}): MementoLike & {
  data: Map<string, unknown>;
  setKeysForSync: ReturnType<typeof vi.fn>;
} {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: vi.fn(<T>(key: string, defaultValue?: T) => (data.has(key) ? (data.get(key) as T) : defaultValue)),
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        data.delete(key);
      } else {
        data.set(key, value);
      }
    }),
    keys: vi.fn(() => Array.from(data.keys())),
    setKeysForSync: vi.fn(),
  };
}

export function createSecrets(initial: Record<string, string> = {}): SecretStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
}
