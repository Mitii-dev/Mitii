export interface ProcessExecRequest {
  argv: readonly string[];
  cwd: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface ProcessExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
}

/**
 * Argv-only process execution. MUST NOT invoke a shell.
 */
export interface ProcessPort {
  execFile(request: ProcessExecRequest): Promise<ProcessExecResult>;
}
