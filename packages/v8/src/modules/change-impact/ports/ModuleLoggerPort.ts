/**
 * Optional stage logger for Change Impact.
 * Hosts/engine may inject; omit for silent analyze.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "change-impact";
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
