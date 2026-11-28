/**
 * Request Intake public surface.
 *
 * Prefer `RequestIntakePipeline`. Helpers below stay exported for hosts/tests
 * during the engine rewrite.
 */

export { RequestIntakePipeline } from "./flow/RequestIntakePipeline";
export type {
  RequestIntakePipelineDependencies,
  RequestIntakeResult,
} from "./flow/RequestIntakePipeline";

export { REQUEST_INTAKE_STAGES } from "./constants";
export type { RequestIntakeStageName } from "./constants";

export { UserRequestEnvelopeBuilder } from "./flow/steps";
export type { CreateUserRequestInput } from "./contracts";
export type {
  UserRequestEnvelope,
  UserRequestEnvelopeBuilderDependencies,
  RequestArtifactReference,
  RequestArtifactKind,
  RequestImageAttachment,
  RequestMetaCommand,
  RequestTurnKind,
  RequestSessionAction,
  MetaCommandLifecycle,
  UserRequestCorrelation,
  UserRequestOrigin,
  UserRequestWorkspaceScope,
  ModuleLoggerPort,
} from "./contracts";
export {
  userRequestEnvelopeSchema,
  requestArtifactReferenceSchema,
  requestImageAttachmentSchema,
  requestMetaCommandSchema,
  createUserRequestInputSchema,
  agentModeSchema,
  noopModuleLogger,
} from "./contracts";
export type { AgentMode } from "./contracts";

export {
  AGENT_MODES,
  INTERACTION_MODE_DEFAULT,
  USER_REQUEST_ORIGINS,
  REQUEST_ENVELOPE_DEFAULTS,
  REQUEST_ENVELOPE_LIMITS,
  REQUEST_TURN_KINDS,
  REQUEST_SESSION_ACTIONS,
  META_COMMAND_LIFECYCLES,
  SUPPORTED_IMAGE_MIME_TYPES,
  BUILTIN_META_COMMAND_SPECS,
} from "./rules";

export { resolveInteractionMode } from "./flow/steps";
export {
  sanitizeUserMessage,
  classifyLeadingCommand,
  parseLeadingCommand,
  isLeadingSlashCommand,
  extractMentionArtifacts,
  mergeReferencedArtifacts,
  normalizeAttachments,
} from "./flow/steps";
