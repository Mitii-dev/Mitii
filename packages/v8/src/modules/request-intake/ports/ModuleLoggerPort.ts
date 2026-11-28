/**
 * Optional stage logger for Request Intake.
 * Hosts/engine may inject; omit for silent intake.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "request-intake";
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
