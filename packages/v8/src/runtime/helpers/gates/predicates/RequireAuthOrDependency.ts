import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

export function requireAuthOrDependency(
  ctx: GateContext,
): GateVerdict | undefined {
  if (!ctx.enableExtendedGates || !ctx.authOrDependencyMissing) {
    return undefined;
  }
  return {
    action: "suspend",
    kind: "auth_or_dependency_required",
    payload: {},
    reasonCodes: ["gate_auth_or_dependency_required"],
  };
}
