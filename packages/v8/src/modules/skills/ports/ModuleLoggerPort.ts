/**
 * Optional stage logger for Skills.
 * Hosts/engine may inject; omit for silent select.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "skills";
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
