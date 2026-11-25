/**
 * Optional stage logger for Repository State.
 * Hosts/engine may inject; omit for silent publish/read/pin.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "repository-state";
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
