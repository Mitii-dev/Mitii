/**
 * Optional stage logger for Prompt Construction.
 * Hosts/engine may inject; omit for silent construct.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "prompt-construction";
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
