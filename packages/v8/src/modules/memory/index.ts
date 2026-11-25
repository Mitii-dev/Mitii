export {
  MEMORY_SCHEMA_VERSION,
  MEMORY_SCOPES,
  MEMORY_PRIVACY_LEVELS,
  MEMORY_FACT_TYPES,
  MEMORY_RETRIEVAL_STATUSES,
  MEMORY_COMMIT_STATUSES,
  MEMORY_OMISSION_REASONS,
  MEMORY_REASON_CODES,
  MEMORY_REASON,
  MEMORY_ERROR_CODES,
  MEMORY_MESSAGES,
  MEMORY_STAGES,
} from "./constants";
export type { MemoryReasonCodeConst, MemoryStageName } from "./constants";

export {
  DEFAULT_MEMORY_BUDGET_TOKENS,
  DEFAULT_MAX_MEMORY_FACTS,
  DEFAULT_CHARACTERS_PER_TOKEN,
  DEFAULT_MIN_MEMORY_SCORE,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_MEMORY_IMPORTANCE,
  DEFAULT_MAX_DERIVED_CONCEPTS,
  DEFAULT_MAX_ACCESS_LOG,
  DEFAULT_EMBED_MAX_CHARS,
} from "./defaults";

export { MemoryPipeline } from "./pipeline/MemoryPipeline";
export type { MemoryPipelineDependencies } from "./pipeline/MemoryPipeline";
export { MemoryContentPolicy } from "./policy/contentPolicy";
export { MEMORY_THRESHOLDS } from "./policy";

export {
  memoryRetrieveInputSchema,
  memoryCommitInputSchema,
  memoryConsolidateInputSchema,
  memoryScopeSchema,
  memoryPrivacySchema,
  memoryFactSchema,
  memoryFactTypeSchema,
  memoryInstructionBlockSchema,
  memoryOmissionSchema,
  memoryRetrieveResultSchema,
  memoryCommitResultSchema,
  memoryConsolidateResultSchema,
  memoryErrorCodeSchema,
  MemoryError,
  noopModuleLogger,
} from "./contracts";
export type {
  MemoryRetrieveInput,
  MemoryCommitInput,
  MemoryConsolidateInput,
  MemoryScope,
  MemoryPrivacy,
  MemoryFact,
  MemoryFactDraft,
  MemoryFactType,
  MemoryInstructionBlock,
  MemoryOmission,
  MemoryRetrieveResult,
  MemoryCommitResult,
  MemoryConsolidateResult,
  MemoryReasonCode,
  MemoryErrorCode,
  MemoryStorePort,
  MemoryIdGeneratorPort,
  MemoryEmbeddingPort,
  ModuleLoggerPort,
} from "./contracts";

export { InMemoryMemoryStore, HashMemoryEmbedding } from "./adapters";
export {
  KnowledgeGraphManager,
  InMemoryKnowledgeGraphStore,
  knowledgeGraphEntitySchema,
  knowledgeGraphRelationSchema,
  knowledgeGraphSchema,
} from "./graph";
export type {
  KnowledgeGraph,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
  KnowledgeGraphPort,
  KnowledgeGraphStorePort,
  KnowledgeGraphDeleteEntitiesResult,
  KnowledgeGraphAddObservationsResult,
} from "./graph";
export { buildSyntheticMemoryDraft } from "./actions";
export type {
  SyntheticObservation,
  SyntheticObservationInput,
} from "./actions";
