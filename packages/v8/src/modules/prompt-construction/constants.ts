/**
 * Stable identifiers for Prompt Construction.
 */
export const PROMPT_CONSTRUCTION_SCHEMA_VERSION = 1 as const;

export const PROMPT_SECTIONS = [
  "system",
  "rules",
  "skills",
  "memory",
  "plan",
  "conversation",
  "repository",
  "tools",
  "output_reserve",
] as const;

export const PROMPT_TRUST_LEVELS = [
  "trusted_instruction",
  "conversation",
  "untrusted_repository_content",
  "untrusted_tool_content",
  "untrusted_memory_content",
] as const;

export const PROMPT_OMISSION_REASONS = [
  "budget",
  "duplicate",
  "capability_unsupported",
  "empty",
  "not_required",
  "grant_empty",
] as const;

export const PROMPT_CONSTRUCTION_STATUSES = [
  "complete",
  "partial",
  "blocked",
] as const;

export const PROMPT_REASON_CODES = [
  "output_reserved_first",
  "dynamic_output_expanded",
  "dynamic_output_limited_by_context",
  "within_provider_limits",
  "partial_context_omitted",
  "tools_omitted_unsupported",
  "tools_filtered_by_grant",
  "repository_not_required",
  "repository_wrapped_untrusted",
  "conversation_compacted",
  "user_request_truncated",
  "blocked_required_overflow",
  "fragment_review_threshold",
  "extra_fragments_injected",
  "skill_catalog_l1_injected",
] as const;

export const PROMPT_CONSTRUCTION_ERROR_CODES = [
  "invalid_input",
  "budget_impossible",
  "serialization_failed",
] as const;

export type PromptReasonCodeConst = (typeof PROMPT_REASON_CODES)[number];

/** Named reason-code accessors — never build codes with string templates. */
export const PROMPT_REASON = {
  outputReservedFirst: "output_reserved_first",
  dynamicOutputExpanded: "dynamic_output_expanded",
  dynamicOutputLimitedByContext: "dynamic_output_limited_by_context",
  withinProviderLimits: "within_provider_limits",
  partialContextOmitted: "partial_context_omitted",
  toolsOmittedUnsupported: "tools_omitted_unsupported",
  toolsFilteredByGrant: "tools_filtered_by_grant",
  repositoryNotRequired: "repository_not_required",
  repositoryWrappedUntrusted: "repository_wrapped_untrusted",
  conversationCompacted: "conversation_compacted",
  userRequestTruncated: "user_request_truncated",
  blockedRequiredOverflow: "blocked_required_overflow",
  fragmentReviewThreshold: "fragment_review_threshold",
  extraFragmentsInjected: "extra_fragments_injected",
  skillCatalogL1Injected: "skill_catalog_l1_injected",
} as const satisfies Record<string, PromptReasonCodeConst>;

export const PROMPT_MESSAGES = {
  inputInvalid: "Prompt Construction input failed schema validation.",
  budgetImpossible:
    "Provider context window cannot reserve output and still fit required system instructions.",
  resultInvalid: "Prompt Construction result failed schema validation.",
  exceedsInputBudget:
    "Constructed prompt exceeds input budget after required sections; status is blocked.",
} as const;

/** Ordered flow stage names (pipeline + logger). */
export const PROMPT_STAGES = {
  allocateBudget: "1-allocate-budget",
  assembleSystem: "2-assemble-system",
  assembleTools: "3-assemble-tools",
  assembleConversation: "4-assemble-conversation",
  assembleUserRequest: "5-assemble-user-request",
  resolveDynamicOutput: "6-resolve-dynamic-output",
} as const;

export type PromptStageName =
  (typeof PROMPT_STAGES)[keyof typeof PROMPT_STAGES];

