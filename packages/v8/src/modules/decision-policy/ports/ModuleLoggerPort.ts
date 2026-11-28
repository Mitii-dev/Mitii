/**
 * Optional stage logger for Decision Policy.
 * Hosts/engine may inject; omit for silent decide/narrow/widen.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "decision-policy";
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
