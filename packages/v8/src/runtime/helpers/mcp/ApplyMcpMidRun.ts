/**
 * Mid-run MCP attach / revoke (§16).
 * Additive stamp or immediate shrink — never re-decides route.
 */

import { evaluateGates, type GateVerdict } from "../gates";
import { stampMcpAttach, revokeMcpAttach } from "./StampMcpAttach";

export type McpMidRunAction = "attach" | "revoke";

export interface ApplyMcpMidRunInput {
  runId: string;
  action: McpMidRunAction;
  serverId: string;
  currentMcpServerIds: readonly string[];
  /** When true and server missing after revoke/attach fail, escalate auth gate. */
  requiredForActiveTask?: boolean;
  enableExtendedGates?: boolean;
}

export interface ApplyMcpMidRunResult {
  mcpServerIds: string[];
  changed: boolean;
  /** Light enrich refresh recommended. */
  refreshEnrich: boolean;
  gateVerdict?: GateVerdict;
  reasonCodes: string[];
}

/**
 * Apply attach (additive) or revoke (immediate shrink).
 * Missing required dependency → optional `auth_or_dependency_required` when extended.
 */
export function applyMcpMidRun(
  input: ApplyMcpMidRunInput,
): ApplyMcpMidRunResult {
  const before = [...input.currentMcpServerIds];
  let next: string[];
  const codes: string[] = [];

  if (input.action === "attach") {
    next = stampMcpAttach({
      allowedMcpServerIds: before,
      attachServerId: input.serverId,
    });
    const changed = next.length !== before.length;
    codes.push(
      changed ? "mcp_mid_run_attached" : "mcp_mid_run_attach_noop",
    );
    return {
      mcpServerIds: next,
      changed,
      refreshEnrich: changed,
      reasonCodes: codes,
    };
  }

  next = revokeMcpAttach({
    allowedMcpServerIds: before,
    revokeServerId: input.serverId,
  });
  const changed = next.length !== before.length;
  codes.push(changed ? "mcp_mid_run_revoked" : "mcp_mid_run_revoke_noop");

  let gateVerdict: GateVerdict | undefined;
  if (
    changed &&
    input.requiredForActiveTask &&
    input.enableExtendedGates
  ) {
    gateVerdict = evaluateGates("mid_loop", {
      runId: input.runId,
      authOrDependencyMissing: true,
      enableExtendedGates: true,
    });
    if (gateVerdict?.action === "suspend") {
      codes.push("mcp_mid_run_auth_gate");
    }
  }

  return {
    mcpServerIds: next,
    changed,
    refreshEnrich: changed,
    gateVerdict,
    reasonCodes: codes,
  };
}
