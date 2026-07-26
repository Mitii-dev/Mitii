/**
 * Minimal VS Code API shim for headless CLI / benchmark runs.
 * Production extension code still uses the real `vscode` module.
 */

export const Uri = {
  file: (path: string) => ({ scheme: 'file', fsPath: path, path }),
};

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
  }),
  workspaceFolders: undefined as undefined | Array<{ uri: { fsPath: string } }>,
  asRelativePath: (uri: { fsPath?: string; path?: string }, _includeWorkspaceFolder?: boolean) => {
    const path = uri.fsPath ?? uri.path ?? '';
    return path.split('/').pop() ?? path;
  },
  createFileSystemWatcher: () => ({
    onDidChange: () => ({ dispose: () => undefined }),
    onDidCreate: () => ({ dispose: () => undefined }),
    onDidDelete: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  }),
};

export const window = {
  activeTextEditor: undefined,
  tabGroups: { all: [] as Array<{ tabs: unknown[] }> },
  showInformationMessage: async (..._args: unknown[]) => undefined,
  showWarningMessage: async (..._args: unknown[]) => undefined,
  showErrorMessage: async (..._args: unknown[]) => undefined,
  showOpenDialog: async () => undefined,
};

export const languages = {
  getDiagnostics: () => [] as Array<[unknown, unknown[]]>,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
};

export const DiagnosticSeverity = languages.DiagnosticSeverity;

export class RelativePattern {
  constructor(
    readonly base: { fsPath: string },
    readonly pattern: string
  ) {}
}

export const commands = {
  executeCommand: async (..._args: unknown[]) => undefined,
};

export type Uri = ReturnType<typeof Uri.file>;
