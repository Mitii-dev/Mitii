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
] as const;

export const AGENT_SUSPENSION_KINDS = [
  "clarification_required",
  "approval_required",
] as const;

export const AGENT_ACTIVE_STAGES = [
  "received",
  "understood",
  "decided",
  "context_ready",
  "model_running",
  "tool_running",
] as const;

export const AGENT_REASON_CODES = [
  "run_started",
  "intake_complete",
  "understanding_complete",
  "decision_complete",
  "clarification_suspended",
  "mutation_deferred",
  "state_pinned",
  "context_retrieved",
  "context_skipped",
  "prompt_constructed",
  "model_completed",
  "tools_executed",
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
  "context_ready",
  "model_delta",
  "tool_started",
  "tool_completed",
  "suspended",
  "warning",
  "terminal",
] as const;
