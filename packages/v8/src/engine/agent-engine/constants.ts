/**
 * Stable identifiers for Agent Engine.
 */
export const AGENT_ENGINE_SCHEMA_VERSION = 1 as const;

/**
 * Developer-facing log verbosity. Controls how much diagnostic detail is
 * attached to RunEvents beyond the events every run already emits.
 *
 * - "minimal": only the baseline event set (pre-existing behavior).
 * - "standard": adds structured reason codes / before-after values for
 *   clamps, drops, and soft failures — low volume, high diagnostic value.
 * - "verbose": adds everything, including per-attempt retry events and
 *   uncapped omission/evidence detail. Higher volume.
 *
 * Defaults to "verbose" so bugs are discoverable by default; hosts that find
 * the volume excessive can turn it down without any behavior change.
 */
export const AGENT_LOG_VERBOSITIES = ["minimal", "standard", "verbose"] as const;
export const DEFAULT_AGENT_LOG_VERBOSITY = "verbose" as const;
export type AgentLogVerbosity = (typeof AGENT_LOG_VERBOSITIES)[number];

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
  "grant_expansion_required",
  "continue_required",
] as const;

export const AGENT_ACTIVE_STAGES = [
  "received",
  "understood",
  "decided",
  "skills_ready",
  "memory_ready",
  "plan_ready",
  "discovery",
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
  "grant_narrowed",
  "grant_expanded",
  "grant_expansion_suspended",
  "grant_expansion_approved",
  "grant_expansion_denied",
  "clarification_suspended",
  "plan_drafted",
  "plan_skipped",
  "plan_approval_suspended",
  "plan_approved",
  /** Host supplied an approved plan on start (cross-run plan→execute handoff). */
  "plan_carried",
  /** Plan mode finished with the structured plan as the terminal answer. */
  "plan_mode_completed",
  "discovery_started",
  "discovery_completed",
  "discovery_failed",
  "discovery_skipped",
  "plan_rejected",
  "plan_edited",
  "task_list_seeded",
  "task_list_updated",
  "task_list_auto_advanced",
  "task_list_refilled",
  "repo_build_state_before_captured",
  "repo_build_state_after_captured",
  "repo_build_state_errors_cleared",
  "repo_build_state_errors_remaining",
  "repo_build_state_new_errors",
  "repo_build_state_remaining_error_batch",
  "verification_incomplete",
  "verification_record_saved",
  "verification_summary_produced",
  "verification_retry_available",
  "verification_retry_loaded",
  "verification_kept_changes",
  "memory_committed",
  "change_impact_gate_blocked",
  "change_impact_observed",
  "approval_suspended",
  "approval_denied",
  "approval_granted",
  "mutation_deferred",
  "state_pinned",
  "skills_selected",
  "skills_skipped",
  "skills_refreshed",
  "memory_retrieved",
  "memory_empty",
  "memory_skipped",
  "exploration_reread_heavy",
  "exploration_stall_broken",
  "stall_continue_suspended",
  "stall_continue_approved",
  "tool_result_deduped",
  "tool_result_already_read",
  "content_cache_path_invalidated",
  "read_ledger_invalidated",
  "prompt_cache_class_no_cache",
  "prompt_cache_class_prompt_cache",
  "established_facts_reinjected",
  "completed_task_results_stubbed",
  "context_retrieved",
  "context_skipped",
  "prompt_constructed",
  "model_completed",
  "output_truncated",
  "output_truncation_recovered",
  "incomplete_answer_recovered",
  "incomplete_answer_fallback",
  "incomplete_execute",
  "unfulfilled_execute_recovered",
  "unfulfilled_execute_exhausted",
  "must_read_nudged",
  "tools_executed",
  "mutation_applied",
  "mutation_rolled_back",
  "verification_passed",
  "verification_failed",
  "verification_repair_attempted",
  "verification_repair_succeeded",
  "verification_repair_batch_activated",
  /** First mutate loop stopped early so remaining model calls can repair. */
  "verification_repair_budget_reserved",
  /** Post-mutation glob/read streak capped so verification can run. */
  "post_mutation_read_capped",
  "verification_skipped",
  "answer_produced",
  "cancelled",
  "budget_exhausted",
  "provider_failed",
  "tool_failed",
  "misconfigured",
  "invalid_input",
  "prompt_blocked",
  /** Request carried an image attachment but the resolved model does not support vision. */
  "vision_unsupported",
  "context_failed",
  "state_unavailable",
  "resume_complete",
  /** A requested run-budget ceiling was reduced by the window policy. */
  "run_budget_clamped",
  /** Turn's maximum output tokens was reduced to avoid exceeding the context window. */
  "output_tokens_clamped",
  /** A best-effort mutation checkpoint commit failed; changes may not be durably committed. */
  "mutation_commit_failed",
  /** Best-effort state unpin failed on a terminal path; pinned state may leak. */
  "state_unpin_failed",
  /** Loading a prior verification retry record failed (distinct from "no record found"). */
  "verification_retry_load_failed",
  /** Building the verification record for persistence failed. */
  "verification_record_build_failed",
  /** LLM verification-summary narration failed or was rejected; a template fallback was used. */
  "verification_narration_failed",
  /** A hard/blocked verification rejection was kept rather than repaired (see rejectKind on the event). */
  "verification_rejected_kept",
  /** A host policy (planApproval: never) suppressed a plan gate that risk analysis required. */
  "plan_gate_suppressed_by_policy",
  /** Plan mode contract upgraded strategy to discover_and_plan before discovery. */
  "plan_mode_discovery_required",
  /** Plan mode discovery finished without file-backed evidence; strategy fell back to clarify. */
  "plan_mode_discovery_insufficient",
  /** Grant expansion included network access (fetch_url/fetch_docs/web_search). */
  "network_access_granted",
  /** One or more values in an emitted event array were truncated for size; see truncated flag. */
  "event_list_truncated",
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
  "grant_narrowed",
  "state_pinned",
  "skills_ready",
  "memory_ready",
  "plan_ready",
  "discovery_started",
  "discovery_progress",
  "discovery_completed",
  "task_list_updated",
  "context_ready",
  "prompt_ready",
  "model_delta",
  "model_turn",
  "tool_started",
  "tool_completed",
  "evidence_updated",
  "suspended",
  "warning",
  "verification_completed",
  "repo_build_state_captured",
  "verification_comparison",
  "verification_record_saved",
  "verification_summary_ready",
  "verification_retry_available",
  "terminal",
] as const;
