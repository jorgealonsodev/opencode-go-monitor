import { vi } from 'vitest';

// This module provides a mock of the vscode API for unit tests.
// It must be imported before any code that uses vscode.

class MockEventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T): void {
    this.listeners.forEach(l => l(data));
  }
}

class MockSecretStorage {
  private _store = new Map<string, string>();
  get = vi.fn(async (key: string) => this._store.get(key) ?? undefined);
  store = vi.fn(async (key: string, value: string) => { this._store.set(key, value); });
  delete = vi.fn(async (key: string) => { this._store.delete(key); });
  onDidChange = vi.fn(() => ({ dispose: vi.fn() }));
}

class MockMemento {
  private _store = new Map<string, unknown>();
  get = vi.fn(<T>(key: string, defaultValue?: T) => this._store.get(key) as T ?? defaultValue);
  update = vi.fn(async (key: string, value: unknown) => { this._store.set(key, value); });
  keys = vi.fn(() => Array.from(this._store.keys()));
}

export const mockVscode = {
  version: '1.85.0',

  // Status bar
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },

  // Window
  window: {
    createStatusBarItem: vi.fn(() => ({
      text: '',
      tooltip: '',
      command: '',
      color: undefined,
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showSaveDialog: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
    onDidChangePowerState: vi.fn(() => ({ dispose: vi.fn() })),
  },

  // Commands
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn(),
  },

  // Workspace
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      update: vi.fn(),
      has: vi.fn(),
      inspect: vi.fn(),
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },

  // Extensions
  extensions: {
    getExtension: vi.fn(),
  },

  // Uri
  Uri: {
    file: vi.fn((path: string) => ({ fsPath: path, toString: () => path, scheme: 'file' })),
    parse: vi.fn((uri: string) => ({ fsPath: uri, toString: () => uri, scheme: 'https' })),
  },

  // env
  env: {
    openExternal: vi.fn(),
    clipboard: {
      readText: vi.fn(),
      writeText: vi.fn(),
    },
  },

  // Event helpers
  EventEmitter: MockEventEmitter,

  // Classes used as interfaces
  SecretStorage: MockSecretStorage,
  Memento: MockMemento,
} as unknown as Record<string, unknown>;
