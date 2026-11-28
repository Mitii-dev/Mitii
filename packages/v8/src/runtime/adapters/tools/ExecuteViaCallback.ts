import type {
  RuntimeToolExecutorPort,
  RuntimeToolExecuteResult,
} from "../../ports/RuntimeToolExecutorPort";
import { checkToolAgainstGrant } from "../../tools/CheckToolAgainstGrant";

/**
 * Grant-gated tool executor. Hosts inject the body (ToolRuntimePipeline.execute, etc.).
 */
export function executeViaCallback(
  body: (input: {
    toolId: string;
    args: unknown;
    invocationId: string;
  }) => Promise<RuntimeToolExecuteResult>,
): RuntimeToolExecutorPort {
  return {
    async execute(input) {
      const check = checkToolAgainstGrant({
        toolId: input.toolId,
        grant: input.grant,
        effect: "read",
      });
      if (!check.ok) {
        return { ok: false, reasonCode: check.reason ?? "tool_not_allowed" };
      }
      return body({
        toolId: input.toolId,
        args: input.args,
        invocationId: input.invocationId,
      });
    },
  };
}
