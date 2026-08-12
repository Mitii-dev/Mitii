export { createMitiiClient, MitiiClient } from './client';
export type { CreateMitiiClientOptions } from './client';

export { MitiiRun, isRunEvent, isTerminalRunEvent, isSuspendedRunEvent } from './run';
export type { AgentRunResult, RunEvent } from './run';

export {
  mitiiStartInputSchema,
  mitiiResumeInputSchema,
  mitiiConversationMessageSchema,
  toAgentEngineStartInput,
} from './contracts';
export type {
  MitiiStartInput,
  MitiiResumeInput,
  MitiiStartDefaults,
  MitiiConversationMessage,
  AgentMode,
  AgentRunBudget,
  RepositoryStateReference,
} from './contracts';

export {
  MitiiSdkError,
  MITII_SDK_ERROR_CODES,
  mapToSdkError,
} from './errors';
export type { MitiiSdkErrorCode } from './errors';

export {
  createDefaultSkillsCatalog,
  DEFAULT_HOST_SKILLS,
} from './defaultSkills';

/** Re-export selected V8 composition helpers for advanced host wiring. */
export {
  composeReadOnlyAgentEngine,
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
  InMemoryRepositoryStateStore,
  InMemoryRunCheckpointStore,
  FileRunCheckpointStore,
  InMemorySkillsCatalog,
  SkillsPipeline,
  SKILLS_SCHEMA_VERSION,
  RepositoryStatePipeline,
  publishRepositoryStateInputSchema,
  REPOSITORY_STATE_SCHEMA_VERSION,
  AGENT_ENGINE_SCHEMA_VERSION,
  PLANNING_SCHEMA_VERSION,
  agentEngineStartInputSchema,
  agentEngineResumeInputSchema,
  agentRunResultSchema,
  planArtifactSchema,
  planningInputSchema,
  planningResultSchema,
  runEventSchema,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceFileSystemManifestReader,
  InMemoryManifestReader,
  InMemoryDiagnosticsAdapter,
  NodeWorkspaceFileSystemAdapter,
  NodeProcessAdapter,
  NodeNetworkAdapter,
  NodeGitAdapter,
  ToolRegistry,
  createBuiltinToolRegistry,
  defineTool,
  DEFAULT_TOOL_DEFINITIONS,
} from '@mitii/v8';
export type {
  LlmPort,
  AgentEngineStartInput,
  AgentEngineResumeInput,
  ComposeReadOnlyAgentEngineOptions,
  PublishRepositoryStateInput,
  PublishRepositoryStateResult,
  RepositoryStateDescriptor,
  WorkspaceIndexingPipelineResult,
  SkillDescriptor,
  SkillsCatalogPort,
  PlanArtifact,
  PlanningInput,
  PlanningResult,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
  ModelToolDefinition,
  RegisteredTool,
  ToolDefinition,
  VerificationResult,
  DiagnosticsPort,
  DiagnosticItem,
  GitPort,
  CodeNavigationPort,
  CodeNavigationQuery,
  AgentRunCheckpoint,
  AgentEngineRunCheckpointStorePort,
  PendingApprovalState,
  OpenAiCompatibleLlmPortConfig,
  OpenAiCompatibleAuthHeader,
} from '@mitii/v8';
