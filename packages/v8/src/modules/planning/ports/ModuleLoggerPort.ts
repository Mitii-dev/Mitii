/**
 * Optional stage logger for Planning.
 * Hosts/engine may inject; omit for silent plan/resolveStrategy.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "planning";
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
