/**
 * Optional stage logger for Request Understanding.
 * Hosts/engine may inject; omit for silent understand.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "request-understanding";
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
