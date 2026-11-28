/**
 * Project hub GateVerdict → turn-loop gate sketch (S11-LOOP).
 */

import type { GateVerdict } from "../gates/kinds";

export type TurnLoopHubGateKind =
  | "mutation_approval_required"
  | "grant_expansion_required"
  | "continue_required"
  | "external_side_effect_required"
  | "destructive_action_required"
  | "auth_or_dependency_required";

export interface TurnLoopHubGate {
  status: "suspended";
  kind: TurnLoopHubGateKind;
  toolId?: string;
  invocationId?: string;
  reasonCodes: string[];
}

const KIND_MAP: Record<string, TurnLoopHubGateKind> = {
  mutation_approval_required: "mutation_approval_required",
  grant_expansion_required: "grant_expansion_required",
  continue_required: "continue_required",
  external_side_effect_required: "external_side_effect_required",
  destructive_action_required: "destructive_action_required",
  auth_or_dependency_required: "auth_or_dependency_required",
};

export function mapGateVerdictToTurnGate(
  verdict: GateVerdict | undefined,
  extra?: { toolId?: string; invocationId?: string },
): TurnLoopHubGate | undefined {
  if (!verdict || verdict.action !== "suspend") return undefined;
  const kind = KIND_MAP[verdict.kind];
  if (!kind) return undefined;
  return {
    status: "suspended",
    kind,
    toolId: extra?.toolId,
    invocationId: extra?.invocationId,
    reasonCodes: [...verdict.reasonCodes],
  };
}
