export {
  SKILLS_SCHEMA_VERSION,
  SKILL_SELECTION_STATUSES,
  SKILL_OMISSION_REASONS,
  SKILL_SELECTION_KINDS,
  SKILL_REASON_CODES,
  SKILLS_ERROR_CODES,
  MAX_REQUIRED_SKILLS,
} from "./constants";

export {
  DEFAULT_SKILLS_BUDGET_TOKENS,
  DEFAULT_MAX_SKILLS,
  DEFAULT_SKILL_CATALOG_L1_MAX_ENTRIES,
  DEFAULT_CHARACTERS_PER_TOKEN,
  DEFAULT_MIN_SKILL_SCORE,
  DEFAULT_MIN_USEFUL_SKILL_TOKENS,
} from "./defaults";

export { SkillsPipeline } from "./pipeline/SkillsPipeline";
export type { SkillsPipelineDependencies } from "./pipeline/SkillsPipeline";

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
} from "./contracts";
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
} from "./contracts";

export { InMemorySkillsCatalog } from "./adapters";
export { KeywordSkillSimilarity } from "./KeywordSkillSimilarity";
export type { SkillSimilarityPort } from "./contracts";
export {
  parseRequiredSkillMentions,
  mergeRequiredSkillIds,
  normalizeSkillId,
} from "./parseRequiredSkillMentions";

/** Bridge maps (Phase 9.2) — understanding → skill evidence. */
export {
  mapUnderstandingToSkillEvidence,
  deriveSkillRepoEvidence,
  formatSkillPromptContent,
} from "./actions";
export type { SkillRepoEvidence } from "./actions";
