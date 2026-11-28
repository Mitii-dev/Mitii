/**
 * Optional stage logger for Review.
 * Hosts/engine may inject; omit for silent prepare/finalize.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "review";
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
