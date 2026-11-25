/**
 * Optional stage logger for Repository Context.
 * Hosts/engine may inject; omit for silent execute.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "repository-context";
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
