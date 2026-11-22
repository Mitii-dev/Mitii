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
 * | Profile        | Max effect | apply_patch? |
 * |----------------|------------|--------------|
 * | none           | none       | no           |
 * | network_only   | read       | no           |
 * | readonly       | read       | no           |
 * | agent_execute  | write      | yes          |
 */
export const GRANT_PROFILES = [
  "none",
  "network_only",
  "readonly",
  "agent_execute",
] as const;

export type GrantProfile = (typeof GRANT_PROFILES)[number];

export interface ToolGrantResolution {
  toolGrant: ToolGrant;
  reasonCodes: DecisionReasonCode[];
  /** Selected profile — debug / decision_made honesty. */
  grantProfile: GrantProfile;
}

/**
 * Mode seal + route → grant profile.
 * Agent mode alone is not enough for write: only agent + execute → agent_execute.
 */
export function selectGrantProfile(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  /** When true, direct_answer may become network_only instead of none. */
  hasNetworkTools: boolean;
}): GrantProfile {
  const { mode, route, hasNetworkTools } = params;

  if (route === EXECUTION_ROUTE.CLARIFY) {
    return "none";
  }

  // Ask / plan are hard seals: never agent_execute regardless of route.
  if (mode === "ask" || mode === "plan") {
    if (route === EXECUTION_ROUTE.DIRECT_ANSWER) {
      return hasNetworkTools ? "network_only" : "none";
    }
    return "readonly";
  }

  // Agent mode
  if (route === EXECUTION_ROUTE.DIRECT_ANSWER) {
    return hasNetworkTools ? "network_only" : "none";
  }
  if (route === EXECUTION_ROUTE.EXECUTE) {
    return "agent_execute";
  }
  // diagnose | repository_answer | plan
  return "readonly";
}

export function profileReasonCode(profile: GrantProfile): DecisionReasonCode {
  switch (profile) {
    case "none":
      return "grant_profile_none";
    case "network_only":
      return "grant_profile_network_only";
    case "readonly":
      return "grant_profile_readonly";
    case "agent_execute":
      return "grant_profile_agent_execute";
  }
}
