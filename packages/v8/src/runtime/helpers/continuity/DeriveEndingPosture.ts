import type { EndingPosture } from "../../../modules/request-understanding";

/**
 * Stamp how this run ended for the next turn's continuity bias.
 */
export function deriveEndingPosture(params: {
  mode: "ask" | "plan" | "agent";
  route: string;
  status: string;
  gateKind?: string;
  mutationSucceeded: boolean;
}): EndingPosture {
  const route = params.route;
  const gate = params.gateKind ?? "";

  if (
    params.status === "suspended" &&
    (gate === "mutation_approval_required" ||
      gate === "tool_approval" ||
      /approval/i.test(gate))
  ) {
    return "awaiting_approval";
  }

  if (route === "clarify" || gate === "clarification_required") {
    return "awaiting_clarify";
  }

  if (params.mutationSucceeded) {
    return "mutated";
  }

  const isAnswerish =
    route === "answer" ||
    route === "repository_answer" ||
    route === "direct_answer" ||
    route === "diagnose";

  if (params.mode === "ask" && isAnswerish) {
    return "answered";
  }

  if (params.mode === "agent" && isAnswerish) {
    return "proposal_ready";
  }

  if (route === "execute" || route === "plan") {
    return "incomplete";
  }

  return "incomplete";
}
