import type { DiagnosticItem, DiagnosticsPort } from "../contracts";

export class InMemoryDiagnosticsAdapter implements DiagnosticsPort {
  constructor(private readonly items: DiagnosticItem[] = []) {}

  public async readDiagnostics(params: {
    workspaceRoot: string;
    paths?: readonly string[];
  }): Promise<DiagnosticItem[]> {
    if (!params.paths || params.paths.length === 0) {
      return [...this.items];
    }
    return this.items.filter((item) =>
      params.paths!.some(
        (p) => item.path === p || item.path.startsWith(`${p}/`),
      ),
    );
  }
}
