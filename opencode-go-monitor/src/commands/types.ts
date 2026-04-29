export interface DisposableLike {
  dispose(): void;
}

export interface WindowLike {
  showInputBox(options?: {
    prompt?: string;
    password?: boolean;
    placeHolder?: string;
    ignoreFocusOut?: boolean;
  }): Thenable<string | undefined>;
  showInformationMessage(message: string): Thenable<unknown>;
  showErrorMessage(message: string): Thenable<unknown>;
  showSaveDialog(options?: {
    defaultUri?: UriLike;
    filters?: Record<string, string[]>;
  }): Thenable<UriLike | undefined>;
}

export interface UriLike {
  fsPath: string;
  toString(): string;
  scheme: string;
}

export interface CommandsLike {
  registerCommand(command: string, callback: (...args: any[]) => any): DisposableLike;
}

export interface EnvLike {
  openExternal(target: UriLike): Thenable<boolean>;
}
