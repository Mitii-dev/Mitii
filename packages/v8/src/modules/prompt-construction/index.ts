export {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
  PROMPT_SECTIONS,
  PROMPT_TRUST_LEVELS,
  PROMPT_OMISSION_REASONS,
  PROMPT_CONSTRUCTION_STATUSES,
  PROMPT_REASON_CODES,
  PROMPT_CONSTRUCTION_ERROR_CODES,
} from "./constants";

export { PromptConstructionPipeline } from "./pipeline/PromptConstructionPipeline";
export type { PromptConstructionPipelineOptions } from "./pipeline/PromptConstructionPipeline";

export {
  promptConstructionInputSchema,
  promptConstructionResultSchema,
  promptBudgetReportSchema,
  promptSectionBudgetSchema,
  promptProvenanceEntrySchema,
  promptOmissionSchema,
  promptInstructionBlockSchema,
  promptInstructionsSchema,
  promptExtraFragmentSchema,
  promptSkillCatalogL1EntrySchema,
  promptRepositoryBlockSchema,
  promptRepositoryContextSchema,
  promptSectionSchema,
  promptTrustLevelSchema,
  promptOmissionReasonSchema,
  promptConstructionStatusSchema,
  promptReasonCodeSchema,
  promptConstructionErrorCodeSchema,
  PromptConstructionError,
} from "./contracts";
export type {
  PromptConstructionInput,
  PromptConstructionResult,
  PromptBudgetReport,
  PromptSectionBudget,
  PromptProvenanceEntry,
  PromptOmission,
  PromptInstructionBlock,
  PromptInstructions,
  PromptExtraFragment,
  PromptSkillCatalogL1Entry,
  PromptRepositoryBlock,
  PromptRepositoryContext,
  PromptSection,
  PromptTrustLevel,
  PromptOmissionReason,
  PromptConstructionStatus,
  PromptReasonCode,
  PromptConstructionErrorCode,
  TokenEstimatorPort,
} from "./contracts";

export { CharacterTokenEstimator } from "./CharacterTokenEstimator";
export {
  estimateTurnOutputHeadroom,
} from "./turnOutputHeadroom";
export type { TurnOutputHeadroom } from "./turnOutputHeadroom";

export {
  FRAGMENT_POLICY,
  assembleFragments,
  matchesMarkedFragment,
  renderFragment,
  BaseInstructionsFragment,
  DecisionBriefFragment,
  InstructionBlockFragment,
  MidConversationUpdateFragment,
  PlanGuidanceFragment,
  ExtraInstructionFragment,
  SkillCatalogFragment,
  formatSkillCatalogL1,
  MID_CONVERSATION_UPDATE_MARKERS,
  MID_CONVERSATION_SYSTEM_MARKERS,
  wrapMidConversationUpdateText,
  wrapMidConversationSystemText,
} from "./internal/fragments";
export type {
  ContextualFragment,
  FragmentRole,
  RenderedFragment,
  AssembledFragments,
  AssembledFragmentOmission,
  SkillCatalogL1Entry,
} from "./internal/fragments";

/** Bridge maps (Phase 9.2) — context → prompt slice / instruction merge. */
export {
  mapContextToPromptSlice,
  mergePromptInstructions,
} from "./actions";
