import { EXECUTION_ROUTE } from "../constants";
import type {
  DecisionReasonCode,
  ExecutionRoute,
  ToolGrant,
} from "../contracts";

/**
 * Discrete grant profiles. Mode + route select exactly one; layers then add
 * network / process / approval / scopes. Ask/plan never select agent_execute.
 *
 * | Profile        | Max effect | Notes |
 * |----------------|------------|-------|
 * | none           | none       | clarify; rare tool-less direct_answer |
 * | network_only   | read       | rare clamp |
 * | readonly       | read       | legacy clamp |
 * | research       | read       | default ask/plan/diagnose/repository_answer |
 * | agent_execute  | write      | agent + execute only |
 */
export const GRANT_PROFILES = [
  "none",
  "network_only",
  "readonly",
  "research",
  "agent_execute",
] as const;

export type GrantProfile = (typeof GRANT_PROFILES)[number];

export interface ToolGrantResolution {
  toolGrant: ToolGrant;
  reasonCodes: DecisionReasonCode[];
  grantProfile: GrantProfile;
}

/**
 * Mode seal + route → grant profile.
 * Agent mode alone is not enough for write: only agent + execute → agent_execute.
 */
export function selectGrantProfile(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  hasNetworkTools: boolean;
}): GrantProfile {
  const { mode, route, hasNetworkTools } = params;

  if (route === EXECUTION_ROUTE.CLARIFY) {
    return "none";
  }

  // Tool-less knowledge Q&A stays none unless network tools are configured.
  if (route === EXECUTION_ROUTE.DIRECT_ANSWER) {
    if (mode === "ask" || mode === "plan") {
      return hasNetworkTools ? "research" : "none";
    }
    return hasNetworkTools ? "research" : "none";
  }

  // Ask / plan seals: never agent_execute.
  if (mode === "ask" || mode === "plan") {
    return "research";
  }

  if (route === EXECUTION_ROUTE.EXECUTE) {
    return "agent_execute";
  }

  // diagnose | repository_answer | plan
  return "research";
}

export function profileReasonCode(profile: GrantProfile): DecisionReasonCode {
  switch (profile) {
    case "none":
      return "grant_profile_none";
    case "network_only":
      return "grant_profile_network_only";
    case "readonly":
      return "grant_profile_readonly";
    case "research":
      return "grant_profile_research";
    case "agent_execute":
      return "grant_profile_agent_execute";
  }
}
