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

/**
 * Symbol-level code intelligence tools (language service or repo-graph).
 * Keep aligned with Tool Runtime catalog and Agent Engine progressive schemas.
 */
export const CODE_INTELLIGENCE_TOOL_IDS = [
  "goto_definition",
  "find_references",
  "hover_symbol",
  "document_symbol",
  "workspace_symbol",
  "find_implementation",
  "call_hierarchy",
] as const;

/** Workspace diagnostics inspection tools. */
export const DIAGNOSTICS_TOOL_IDS = ["read_diagnostics"] as const;

/** Repository blast-radius analysis tools. */
export const CHANGE_IMPACT_TOOL_IDS = ["analyze_change_impact"] as const;

/** Tool catalog IDs Decision Policy may grant (must stay aligned with Tool Runtime). */
export const READ_ONLY_TOOL_IDS = [
  "describe_tool",
  "list_directory",
  "directory_tree",
  "read_file",
  "read_many_files",
  "glob_files",
  "file_metadata",
  "search_files",
  ...DIAGNOSTICS_TOOL_IDS,
  "read_git_status",
  "read_git_log",
  "read_git_show",
  "read_git_branches",
  ...CODE_INTELLIGENCE_TOOL_IDS,
  ...CHANGE_IMPACT_TOOL_IDS,
  "emit_review_finding",
  "run_readonly_command",
  "read_package_scripts",
  "sequential_thinking",
  "get_current_time",
  "convert_time",
  "memory_graph_search",
  "memory_graph_open",
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
  "memory_graph_update",
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
  "review_pipeline_required",
  "review_findings_structured",
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
  /**
   * Host reported code-navigation capability status for grant/prompt honesty
   * (`available` | `degraded` | `unavailable`).
   */
  "code_navigation_available",
  "code_navigation_degraded",
  "code_navigation_unavailable",
  /** Host injected a DiagnosticsPort for Problems / language-service diagnostics. */
  "diagnostics_port_available",
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
  /** High-confidence understanding preferred over looksLike heuristics. */
  "policy_facts_first",
  /** Safety heuristic overrode facts-first (e.g. pasted runtime dump). */
  "policy_facts_safety_override",
  /** Heuristic vs ballot conflict with material grant impact → clarify. */
  "policy_facts_heuristic_conflict_clarify",
  /**
   * Soft read-only / soft plan / soft dump heuristics lost to a ≥70% LLM
   * act/mutation ballot (same authority rule as SuperIntent; follow-ups too).
   */
  "policy_llm_authority_write",
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
