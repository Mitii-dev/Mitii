/**
 * Optional stage logger for Memory.
 * Hosts/engine may inject; omit for silent retrieve/commit.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "memory";
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
