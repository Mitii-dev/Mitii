/**
 * Skills public surface.
 *
 * Prefer `SkillsPipeline.select` for catalog → instruction blocks.
 */

export {
  SKILLS_SCHEMA_VERSION,
  SKILL_SELECTION_STATUSES,
  SKILL_OMISSION_REASONS,
  SKILL_SELECTION_KINDS,
  SKILL_REASON_CODES,
  SKILL_REASON,
  SKILLS_ERROR_CODES,
  SKILLS_MESSAGES,
  SKILLS_STAGES,
  MAX_REQUIRED_SKILLS,
  MAX_PREFERRED_SKILLS,
} from "./constants";
export type {
  SkillReasonCodeConst,
  SkillsStageName,
} from "./constants";

export {
  DEFAULT_SKILLS_BUDGET_TOKENS,
  DEFAULT_MAX_SKILLS,
  DEFAULT_SKILL_CATALOG_L1_MAX_ENTRIES,
  DEFAULT_CHARACTERS_PER_TOKEN,
  DEFAULT_MIN_SKILL_SCORE,
  DEFAULT_MIN_USEFUL_SKILL_TOKENS,
} from "./defaults";

export { SKILLS_THRESHOLDS } from "./rules";

export { SkillsPipeline } from "./actions/SkillsPipeline";
export type { SkillsPipelineDependencies } from "./actions/SkillsPipeline";

export {
  skillsSelectInputSchema,
  skillTaskEvidenceSchema,
  skillDescriptorSchema,
  skillInstructionBlockSchema,
  skillOmissionSchema,
  skillCatalogL1EntrySchema,
  skillsSelectResultSchema,
  skillsErrorCodeSchema,
  skillBodySchema,
  skillIndexEntrySchema,
  skillResourceManifestSchema,
  SkillsError,
  noopModuleLogger,
} from "./types";
export type {
  SkillsSelectInput,
  SkillTaskEvidence,
  SkillBody,
  SkillDescriptor,
  SkillIndexEntry,
  SkillInstructionBlock,
  SkillOmission,
  SkillCatalogL1Entry,
  SkillResourceManifest,
  SkillsSelectResult,
  SkillReasonCode,
  SkillsErrorCode,
  SkillsCatalogPort,
  SkillSimilarityPort,
  ModuleLoggerPort,
} from "./types";

export {
  InMemorySkillsCatalog,
  KeywordSkillSimilarity,
} from "./impl";

export {
  parseRequiredSkillMentions,
  mergeRequiredSkillIds,
  normalizeSkillId,
  mapUnderstandingToSkillEvidence,
  deriveSkillRepoEvidence,
  formatSkillPromptContent,
} from "./actions/steps";
export type { SkillRepoEvidence } from "./actions/steps";
