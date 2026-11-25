/**
 * Optional stage logger for Task List.
 * Hosts/engine may inject; omit for silent apply/derive.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "task-list";
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
