/**
 * Stable identifiers for Agent Engine.
 */
export const AGENT_ENGINE_SCHEMA_VERSION = 1 as const;

export const AGENT_RUN_STATUSES = [
  "completed",
  "suspended",
  "cancelled",
  "budget_exhausted",
  "failed",
  "approval_denied",
] as const;

export const AGENT_SUSPENSION_KINDS = [
  "clarification_required",
  "approval_required",
  "plan_approval_required",
] as const;

export const AGENT_ACTIVE_STAGES = [
  "received",
  "understood",
  "decided",
  "skills_ready",
  "memory_ready",
  "plan_ready",
  "context_ready",
  "model_running",
  "tool_running",
  "verifying",
] as const;

export const AGENT_REASON_CODES = [
  "run_started",
  "intake_complete",
  "understanding_complete",
  "decision_complete",
  "clarification_suspended",
  "plan_drafted",
  "plan_skipped",
  "plan_approval_suspended",
  "plan_approved",
  /** Host supplied an approved plan on start (cross-run plan→execute handoff). */
  "plan_carried",
  "plan_rejected",
  "plan_edited",
  "approval_suspended",
  "approval_denied",
  "approval_granted",
  "mutation_deferred",
  "state_pinned",
  "skills_selected",
  "skills_skipped",
  "memory_retrieved",
  "memory_skipped",
  "context_retrieved",
  "context_skipped",
  "prompt_constructed",
  "model_completed",
  "output_truncated",
  "output_truncation_recovered",
  "incomplete_answer_recovered",
  "tools_executed",
  "mutation_applied",
  "mutation_rolled_back",
  "verification_passed",
  "verification_failed",
  "verification_repair_attempted",
  "verification_repair_succeeded",
  "verification_skipped",
  "answer_produced",
  "cancelled",
  "budget_exhausted",
  "provider_failed",
  "tool_failed",
  "misconfigured",
  "invalid_input",
  "prompt_blocked",
  "context_failed",
  "state_unavailable",
  "resume_complete",
] as const;


export const AGENT_ERROR_CODES = [
  "invalid_input",
  "misconfigured_ports",
  "execution_failed",
] as const;

export const AGENT_EVENT_TYPES = [
  "stage_started",
  "stage_completed",
  "decision_made",
  "state_pinned",
  "skills_ready",
  "memory_ready",
  "plan_ready",
  "context_ready",
  "model_delta",
  "model_turn",
  "tool_started",
  "tool_completed",
  "suspended",
  "warning",
  "verification_completed",
  "terminal",
] as const;
