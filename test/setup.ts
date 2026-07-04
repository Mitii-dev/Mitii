import { vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue: unknown) => defaultValue,
    }),
    workspaceFolders: undefined,
    asRelativePath: (uri: { fsPath?: string }) => uri.fsPath?.split('/').pop() ?? '',
    createFileSystemWatcher: () => ({
      onDidChange: () => ({ dispose: () => undefined }),
      onDidCreate: () => ({ dispose: () => undefined }),
      onDidDelete: () => ({ dispose: () => undefined }),
      dispose: () => undefined,
    }),
  },
  window: {
    activeTextEditor: undefined,
    tabGroups: { all: [] },
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showOpenDialog: async () => undefined,
  },
  Uri: {
    file: (path: string) => ({ scheme: 'file', fsPath: path, path }),
  },
  RelativePattern: class {
    constructor(public base: unknown, public pattern: string) {}
  },
  languages: {
    getDiagnostics: () => [],
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  commands: {
    executeCommand: async () => undefined,
  },
}));
