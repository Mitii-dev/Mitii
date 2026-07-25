export { RequestIntakePipeline } from "./modules/request-intake";
export { UserRequestEnvelopeBuilder } from "./modules/request-intake";
export type {
  UserRequestEnvelope,
  CreateUserRequestInput,
  AgentMode,
} from "./modules/request-intake";
export {
  agentModeSchema,
  userRequestEnvelopeSchema,
} from "./modules/request-intake";

export { RequestUnderstandingPipeline } from "./modules/request-understanding";
export type {
  TaskAnalysis,
  RequestUnderstandingPipelineInput,
  RequestUnderstandingResult,
} from "./modules/request-understanding";
export {
  requestUnderstandingPipelineInputSchema,
  requestUnderstandingResultSchema,
  TaskAnalysisSchema,
} from "./modules/request-understanding";

export { WorkspaceIndexingPipeline } from "./modules/repository-state";
export {
  LANGUAGE_IDS,
  languageIdSchema,
  LanguageProfileRegistry,
  defaultLanguageProfileRegistry,
} from "./modules/repository-state";
export type {
  LanguageId,
  LanguageProfile,
  ProjectDescriptor,
} from "./modules/repository-state";

export { RepositoryContextPipeline } from "./modules/repository-context";

export type {
  LlmPort,
  ModelRequest,
  ModelCapabilities,
  ModelEvent,
} from "./modules/model-gateway";
export {
  ModelCapabilityResolver,
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
  MODEL_PROVIDER_SUPPORT,
  modelEventSchema,
} from "./modules/model-gateway";
