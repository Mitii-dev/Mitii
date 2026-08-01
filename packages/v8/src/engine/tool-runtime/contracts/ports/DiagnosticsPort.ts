export interface DiagnosticItem {
  path: string;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  source?: string;
  code?: string;
}

export interface DiagnosticsPort {
  readDiagnostics(params: {
    workspaceRoot: string;
    paths?: readonly string[];
  }): Promise<DiagnosticItem[]>;
}
