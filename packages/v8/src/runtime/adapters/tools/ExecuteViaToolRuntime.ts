import type { ToolRuntimePipeline } from "../../../engine/tool-runtime";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../../engine/tool-runtime";
import type { RuntimeToolExecutorPort } from "../../ports/RuntimeToolExecutorPort";
import { checkToolAgainstGrant } from "../../tools/CheckToolAgainstGrant";
import { classifyToolEffect } from "../../tools/ClassifyToolEffect";
import { needsMutationApproval } from "../../tools/NeedsMutationApproval";
import { grantSurfaceToToolGrant } from "./GrantSurfaceToToolGrant";

/**
 * Adapt engine ToolRuntimePipeline → RuntimeToolExecutorPort (P8 cutover).
 * Pre-checks grant via runtime/tools, then delegates execute.
 */
export function executeViaToolRuntime(params: {
  pipeline: ToolRuntimePipeline;
  workspaceRoot: string;
}): RuntimeToolExecutorPort {
  const { pipeline, workspaceRoot } = params;
  return {
    async execute(input) {
      const effect = classifyToolEffect(input.toolId);
      const check = checkToolAgainstGrant({
        toolId: input.toolId,
        grant: input.grant,
        effect,
      });
      if (!check.ok) {
        return { ok: false, reasonCode: check.reason ?? "tool_not_allowed" };
      }
      if (needsMutationApproval({ effect, grant: input.grant })) {
        return { ok: false, reasonCode: "approval_required" };
      }

      const result = await pipeline.execute({
        schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
        callId: input.invocationId,
        toolName: input.toolId,
        arguments: input.args ?? {},
        grant: grantSurfaceToToolGrant(input.grant),
        workspaceRoot,
      });

      const ok = result.status === "succeeded";
      return {
        ok,
        output: result.output,
        reasonCode: result.reasonCode,
      };
    },
  };
}
