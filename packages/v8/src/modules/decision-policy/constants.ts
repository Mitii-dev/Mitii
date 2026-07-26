/**
 * Stable identifiers for Decision Policy.
 */
export const DECISION_POLICY_SCHEMA_VERSION = 1 as const;

export const EXECUTION_ROUTES = [
  "direct_answer",
  "repository_answer",
  "clarify",
  "diagnose",
  "plan",
  "execute",
] as const;

export const PLANNING_DEPTHS = ["none", "internal", "visible"] as const;

export const RUN_DISPOSITIONS = [
  "continue",
  "clarification_required",
] as const;

export const WORKSPACE_EFFECTS = ["none", "read", "write"] as const;

export const TOOL_EFFECTS = [
  "workspace_read",
  "workspace_write",
  "process_execute",
  "network_access",
  "git_write",
  "external_write",
  "secret_use",
] as const;

export const APPROVAL_MODES = [
  "never",
  "when_required",
  "every_mutation",
] as const;

export const VERIFICATION_EVIDENCE_KINDS = [
  "diagnostics",
  "tests",
  "typecheck",
  "lint",
  "build",
  "diff_review",
] as const;

/** Tool catalog IDs that Tool Runtime (Phase 4) will enforce. */
export const READ_ONLY_TOOL_IDS = [
  "list_directory",
  "read_file",
  "search_files",
  "read_diagnostics",
  "read_git_status",
  "run_readonly_command",
] as const;

export const MUTATION_TOOL_IDS = [
  "apply_patch",
  "run_command",
] as const;

export const DECISION_REASON_CODES = [
  "mode_ask_readonly",
  "mode_plan_only",
  "clarification_material",
  "diagnosis_readonly",
  "simple_localized_no_visible_plan",
  "multi_file_internal_plan",
  "architecture_visible_plan",
  "explicit_plan_request",
  "high_risk_approval",
  "repository_context_required",
  "repository_state_degraded",
  "repository_state_unavailable",
  "prompt_injection_ignored",
  "direct_knowledge_answer",
  "repository_grounded_answer",
  "mutation_execute",
  "verification_required",
  "verification_not_required",
] as const;

export const DECISION_POLICY_ERROR_CODES = [
  "invalid_input",
  "incompatible_understanding",
] as const;

export const MUTATION_TASK_INTENTS = [
  "bugfix",
  "feature",
  "refactor",
  "optimize",
  "scaffold",
  "migrate",
  "schema",
  "mock",
  "config",
  "dependency",
  "style",
  "format",
  "security",
  "test",
] as const;

export const DIAGNOSIS_TASK_INTENTS = [
  "diagnose",
  "trace",
  "audit",
  "review",
] as const;

export const ANSWER_TASK_INTENTS = ["question", "docs"] as const;
