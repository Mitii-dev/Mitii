/**
 * Injected after the user approves Continue on a budget/stall wall (§10.3).
 */

import type { ContinueReason } from "./constants";
import { mapLegacyContinueReason } from "./MapLegacyContinueReason";

export interface BuildBudgetWallResetMessageInput {
  reason: ContinueReason | string;
  guidance?: string;
  mutationRequired: boolean;
  changedFiles: readonly string[];
  /** Optional preflight diagnostic batch to re-anchor Continue resumes. */
  preflightDiagnostics?: string;
}

export function buildBudgetWallResetMessage(
  params: BuildBudgetWallResetMessageInput,
): string {
  const reason = mapLegacyContinueReason(params.reason);
  const parts: string[] = [];

  switch (reason) {
    case "stalled_or_blocked":
      parts.push(
        "The user approved continuing after a stall/block wall. Do not repeat the same re-read loop.",
      );
      break;
    case "incomplete_progress":
      parts.push(
        "The user approved continuing after incomplete progress. Finish remaining change surfaces or stop with a clear blocker. Prefer apply_patch/delete_file/move_file on a bounded surface when mutation is required.",
      );
      break;
    case "evidence_clarify":
      parts.push(
        "The user approved continuing after an evidence-clarify wall (engine stop — not a mutate resume). Do NOT force apply_patch yet. If they shared an explicit file path in guidance, bind to that path only (read_file then apply_patch). If no path was shared, ask for one or stop — do not reopen broad search/list/glob.",
      );
      break;
    case "provider_unavailable":
      parts.push(
        "The user approved continuing after a model-provider infrastructure outage. Retry the next model turn; do not restart discovery or invent a new plan. Prefer completing the current checklist step.",
      );
      break;
    case "budget_exhausted":
      parts.push(
        "The user approved extending the run after budget exhaustion. Prefer a bounded next mutation or verification step.",
      );
      break;
    case "verification_repair_capped":
      parts.push(
        "The user approved another verification repair pass. Fix remaining errors with bounded patches; do not restart broad exploration.",
      );
      break;
  }

  const diagnostics = params.preflightDiagnostics?.trim();
  if (diagnostics) {
    parts.push(
      "Use these preflight diagnostics as the next patch targets; do not restart broad discovery:\n" +
        diagnostics,
    );
  }

  if (
    params.mutationRequired &&
    params.changedFiles.length === 0 &&
    reason !== "verification_repair_capped" &&
    reason !== "budget_exhausted" &&
    reason !== "provider_unavailable" &&
    reason !== "evidence_clarify"
  ) {
    parts.push(
      "Call apply_patch/delete_file/move_file now, or stop with a clear blocker. Analysis-only turns are not allowed.",
    );
  } else if (reason === "stalled_or_blocked" || reason === "incomplete_progress") {
    parts.push(
      "Change strategy: target remaining checklist writes, or finish with a concrete answer.",
    );
  }

  const guidance = params.guidance?.trim();
  if (guidance) {
    parts.push(`User guidance: ${guidance}`);
  }
  return parts.join(" ");
}
