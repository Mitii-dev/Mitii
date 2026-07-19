export interface WorkspacePort {
  readonly workspaceRoot: string;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
}

export interface EditorContextPort {
  getOpenFiles(): Promise<readonly string[]>;
  getActiveFile(): Promise<string | undefined>;
}

export interface DiagnosticsPort {
  getDiagnostics(paths?: readonly string[]): Promise<readonly unknown[]>;
}

export interface DiffPreviewPort {
  previewWrite(relPath: string, newContent: string): Promise<void>;
  previewPatch(relPath: string, oldText: string, newText: string): Promise<void>;
}

export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface SettingsStore {
  get<TValue>(key: string): TValue | undefined;
  update<TValue>(key: string, value: TValue): Promise<void>;
}

export interface ChatPresenter {
  publish(event: unknown): void | Promise<void>;
}

export interface HostPorts {
  workspace: WorkspacePort;
  editor?: EditorContextPort;
  diagnostics?: DiagnosticsPort;
  diffPreview?: DiffPreviewPort;
  secrets?: SecretStore;
  settings?: SettingsStore;
  presenter?: ChatPresenter;
}
