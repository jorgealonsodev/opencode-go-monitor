export interface DisposableLike {
  dispose(): void;
}

export interface QuickPickItemLike {
  label: string;
  description?: string;
  detail?: string;
}

export interface WorkspaceConfigurationLike {
  get<T>(section: string, defaultValue?: T): T;
  update(section: string, value: unknown): Thenable<void>;
}

export interface WindowLike {
  showInputBox(options?: {
    prompt?: string;
    password?: boolean;
    placeHolder?: string;
    ignoreFocusOut?: boolean;
  }): Thenable<string | undefined>;
  showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  showSaveDialog(options?: {
    defaultUri?: UriLike;
    filters?: Record<string, string[]>;
  }): Thenable<UriLike | undefined>;
  showQuickPick<T extends QuickPickItemLike>(items: readonly T[], options?: {
    placeHolder?: string;
    ignoreFocusOut?: boolean;
  }): Thenable<T | undefined>;
}

export interface UriLike {
  fsPath: string;
  toString(): string;
  scheme: string;
}

export interface CommandsLike {
  registerCommand(command: string, callback: (...args: any[]) => any): DisposableLike;
  executeCommand<T = unknown>(command: string, ...args: any[]): Thenable<T | undefined>;
}

export interface EnvLike {
  openExternal(target: UriLike): Thenable<boolean>;
}
