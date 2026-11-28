/**
 * Optional stage logger for Verification.
 * Hosts/engine may inject; omit for silent verify.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "verification";
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
