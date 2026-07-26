import type { ProcessExecRequest, ProcessExecResult, ProcessPort } from "../contracts";

export type ProcessHandler = (
  request: ProcessExecRequest,
) => Promise<ProcessExecResult> | ProcessExecResult;

/**
 * Test double for argv process execution.
 */
export class InMemoryProcessAdapter implements ProcessPort {
  constructor(private readonly handler: ProcessHandler) {}

  public execFile(request: ProcessExecRequest): Promise<ProcessExecResult> {
    return Promise.resolve(this.handler(request));
  }
}
