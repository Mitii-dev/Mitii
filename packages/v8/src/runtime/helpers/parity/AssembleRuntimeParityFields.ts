import { stampMcpAttach } from "../mcp/StampMcpAttach";
import { buildTaskHandoff } from "../handoff/BuildTaskHandoff";
import type { ContextBundleSketch } from "../../flow/steps/9-EnrichContext";
import type { TurnLoopSketch } from "../../flow/steps/10-TurnLoop";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";

export interface RuntimeParityFields {
  mcpServerIds?: string[];
  handoff?: {
    fromTaskId?: string;
    toTaskId?: string;
    reason: string;
  };
  context?: {
    summary: string;
    focusPathCount: number;
    blockCount: number;
  };
  prompt?: {
    toolCount: number;
    status: "complete" | "partial" | "blocked";
  };
  reasonCodes: string[];
}

/** Shared MCP / handoff / context / prompt sketches for RuntimeRunResult + bridge. */
export function assembleRuntimeParityFields(params: {
  startMcpServerIds?: string[];
  deps?: RuntimeDependencies;
  contextBundle?: ContextBundleSketch;
  turnLoop?: TurnLoopSketch;
  suspendedGateKind?: string;
}): RuntimeParityFields {
  const reasonCodes: string[] = [];
  let mcpServerIds = [...(params.startMcpServerIds ?? [])];
  for (const id of params.deps?.mcpServerIds ?? []) {
    mcpServerIds = stampMcpAttach({
      allowedMcpServerIds: mcpServerIds,
      attachServerId: id,
    });
  }
  if (mcpServerIds.length > 0) {
    reasonCodes.push("mcp_attach_stamped");
  }

  let handoff: RuntimeParityFields["handoff"];
  if (params.suspendedGateKind) {
    const built = buildTaskHandoff({
      reason: `suspend:${params.suspendedGateKind}`,
    });
    handoff = {
      fromTaskId: built.fromTaskId,
      toTaskId: built.toTaskId,
      reason: built.reason,
    };
    reasonCodes.push(...built.reasonCodes);
  }

  const bundle = params.contextBundle;
  const context = bundle
    ? {
        summary: bundle.summary,
        focusPathCount: bundle.focusPaths.length,
        blockCount: Math.max(1, bundle.focusPaths.length),
      }
    : undefined;
  if (context) reasonCodes.push("context_bundle_ready");

  const tools = params.turnLoop?.packedTools ?? [];
  const prompt =
    params.turnLoop != null
      ? {
          toolCount: tools.length,
          status: "complete" as const,
        }
      : undefined;
  if (prompt) reasonCodes.push("prompt_pack_ready");

  return {
    mcpServerIds: mcpServerIds.length > 0 ? mcpServerIds : undefined,
    handoff,
    context,
    prompt,
    reasonCodes,
  };
}
