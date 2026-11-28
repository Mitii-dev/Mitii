/**
 * Optional stage logger for Code Navigation.
 * Hosts/engine may inject; omit for silent navigate.
 */
export interface ModuleLoggerPort {
  stage(event: {
    module: "code-navigation";
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
