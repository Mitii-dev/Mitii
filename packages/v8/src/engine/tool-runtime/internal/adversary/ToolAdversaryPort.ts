import type { ToolGrant } from "../../../../modules/decision-policy";
import type { ToolDefinition } from "../ToolCatalog";

/**
 * Progressive safety fence consulted AFTER Decision Policy grant and BEFORE
 * tool execute. Restrict-only: never grants tools or widens effects.
 *
 * Default unset = no-op (today's behavior).
 */
export type AdversaryDecision = "ALLOW" | "ASK" | "BLOCK";

export interface AdversaryEvaluateInput {
  toolName: string;
  arguments: unknown;
  grant: ToolGrant;
  tool: ToolDefinition;
  workspaceRoot: string;
}

export interface AdversaryEvaluateResult {
  decision: AdversaryDecision;
  reason: string;
}

export interface ToolAdversaryPort {
  evaluate(
    input: AdversaryEvaluateInput,
  ): AdversaryEvaluateResult | Promise<AdversaryEvaluateResult>;
}

/** Tools the adversary may inspect (high-risk). Others are ALLOW by default. */
export const ADVERSARY_HIGH_RISK_TOOL_IDS = [
  "run_command",
  "delete_file",
  "delete_directory",
  "fetch_url",
  "fetch_docs",
  "web_search",
  "create_github_issue",
  "create_pull_request",
] as const;

export function isAdversaryHighRiskTool(name: string): boolean {
  return (ADVERSARY_HIGH_RISK_TOOL_IDS as readonly string[]).includes(name);
}

/**
 * Fail mode when the adversary throws or returns an invalid decision.
 * - fail_closed: treat as BLOCK (safe / guided)
 * - fail_open: treat as ALLOW (pilot / automation opt-in)
 */
export type AdversaryFailMode = "fail_closed" | "fail_open";
