/**
 * Optional stage logger for Window Budget.
 * Hosts/engine may inject; omit for silent derive.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "window-budget";
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
