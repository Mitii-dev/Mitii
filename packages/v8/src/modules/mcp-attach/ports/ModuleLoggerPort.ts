/**
 * Optional stage logger for MCP attach.
 * Hosts/engine may inject; omit for silent helpers.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "mcp-attach";
    stage: string;
    durationMs: number;
    reasonCodes: readonly string[];
    inputSummary?: Record<string, unknown>;
    outputSummary?: Record<string, unknown>;
  }): void;
}

export const noopModuleLogger: ModuleLoggerPort = {
  stage() {
    /* no-op */
  },
};
