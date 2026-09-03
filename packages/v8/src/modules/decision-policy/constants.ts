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

/**
 * Whether execute must pause for plan approval before mutation.
 * Orthogonal to planningDepth (which controls plan visibility/detail).
 */
export const PLAN_GATES = ["none", "required_before_execute"] as const;

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

/** Tool catalog IDs Decision Policy may grant (must stay aligned with Tool Runtime). */
export const READ_ONLY_TOOL_IDS = [
  "list_directory",
  "read_file",
  "read_many_files",
  "glob_files",
  "file_metadata",
  "search_files",
  "read_diagnostics",
  "read_git_status",
  "goto_definition",
  "find_references",
  "analyze_change_impact",
  "run_readonly_command",
  "read_package_scripts",
] as const;

/** Process tools that may change workspace state through repository scripts. */
export const PROCESS_TOOL_IDS = [
  "run_command",
] as const;

/** Executable mutation tools for direct workspace mutations. */
export const MUTATION_TOOL_IDS = [
  "apply_patch",
  "delete_file",
  "delete_directory",
  "move_file",
] as const;

/** External GitHub write tools (require `gh` auth in the environment). */
export const GITHUB_MUTATION_TOOL_IDS = [
  "create_github_issue",
  "create_pull_request",
] as const;

export const DECISION_REASON_CODES = [
  "mode_ask_readonly",
  "mode_plan_only",
  "clarification_material",
  "diagnosis_readonly",
  "simple_localized_no_visible_plan",
  "multi_file_internal_plan",
  "architecture_visible_plan",
  /** Greenfield / full-package implementation treated as architecture-scale work. */
  "large_implementation_visible_plan",
  /** Package/multi-file repair execute gets a visible plan + live checklist seed. */
  "broad_repair_visible_plan",
  /** Long structured execute briefs get an internal plan (length alone never forces repository_answer). */
  "long_prompt_internal_plan",
  /** Long structured execute briefs get a visible plan when the window can afford it. */
  "long_prompt_visible_plan",
  /** Prompt/engine should prefer analyze_change_impact before shared-surface mutations. */
  "change_impact_recommended",
  /** Execute route should capture scoped build/typecheck evidence before planning. */
  "preflight_build_recommended",
  /** Understanding risk was low but shared-scope repair elevated effective grant risk. */
  "shared_scope_risk_elevated",
  "explicit_plan_request",
  "plan_gate_none",
  "plan_gate_required",
  "high_risk_approval",
  "repository_context_required",
  "repository_state_degraded",
  "repository_state_unavailable",
  "prompt_injection_ignored",
  "direct_knowledge_answer",
  "repository_grounded_answer",
  "mutation_execute",
  /** Workspace-grounded bug report promoted to execute (may still be diagnose-first). */
  "workspace_bug_execute",
  /** Agent reported a runtime symptom (loading/hang) — diagnose with tools, not tool-less chat. */
  "workspace_symptom_diagnose",
  "mutation_budget_relaxed",
  "mutation_budget_standard",
  "mutation_budget_tight",
  "process_execution_granted",
  "verification_required",
  "verification_not_required",
  /** Agent/ask asked to run tests or inspect pass/fail — diagnose with process tools. */
  "verification_run_requested",
  "grant_narrowed",
  /** Read/write scopes expanded after path_out_of_scope or compiler errors. */
  "grant_expanded",
  /** Grant expansion included network access (fetch_url/fetch_docs/web_search). */
  "network_access_granted",
  /** A host policy (planApproval: never) suppressed a plan gate risk analysis required. */
  "plan_gate_suppressed_by_policy",
  /** The window-derived mutation budget further tightened the profile-selected budget. */
  "mutation_budget_window_clamped",
  /** Request originated from automation (cron, CI, webhook) rather than an interactive user. */
  "automation_origin",
  /** Request originated from an API client rather than an interactive user. */
  "api_origin",
  /**
   * Unattended origin would have clarified; Decision Policy continued with the
   * best-effort non-clarify route instead of suspending for interactive input.
   */
  "automation_clarify_suppressed",
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
