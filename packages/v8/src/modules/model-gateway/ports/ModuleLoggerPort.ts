/**
 * Optional stage logger for Model Gateway.
 * Hosts/engine may inject; omit for silent resolve/complete.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "model-gateway";
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
