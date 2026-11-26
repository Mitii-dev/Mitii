import type { GrantSurface } from "../tools/CheckToolAgainstGrant";

/** Thin tool execute boundary — grant checked before call. */
export interface RuntimeToolExecuteInput {
  toolId: string;
  args: unknown;
  grant: GrantSurface;
  invocationId: string;
}

export interface RuntimeToolExecuteResult {
  ok: boolean;
  output?: unknown;
  reasonCode?: string;
}

export interface RuntimeToolExecutorPort {
  execute(input: RuntimeToolExecuteInput): Promise<RuntimeToolExecuteResult>;
}
