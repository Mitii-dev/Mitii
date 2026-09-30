export { UserRequestEnvelopeBuilder } from "./request-envelope/UserRequestEnvelopeBuilder";
export type { CreateUserRequestInput } from "./contracts/input/CreateUserRequestInput";
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
} from "./request-envelope/types";
export {
  userRequestEnvelopeSchema,
  requestArtifactReferenceSchema,
  requestImageAttachmentSchema,
  requestMetaCommandSchema,
} from "./request-envelope/schema";

export { agentModeSchema, resolveInteractionMode } from "./interaction-mode";
export type { AgentMode } from "./interaction-mode/types";
export { AGENT_MODES, INTERACTION_MODE_DEFAULT } from "./interaction-mode/constants";

export {
  createUserRequestInputSchema,
} from "./contracts";

export {
  USER_REQUEST_ORIGINS,
  REQUEST_ENVELOPE_DEFAULTS,
  REQUEST_ENVELOPE_LIMITS,
  REQUEST_TURN_KINDS,
  REQUEST_SESSION_ACTIONS,
  META_COMMAND_LIFECYCLES,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "./request-envelope/constants";

export { RequestIntakePipeline } from "./pipeline/RequestIntakePipeline";
export type {
  RequestIntakePipelineDependencies,
  RequestIntakeResult,
} from "./pipeline/RequestIntakePipeline";

export { sanitizeUserMessage } from "./sanitize";
export {
  classifyLeadingCommand,
  parseLeadingCommand,
  isLeadingSlashCommand,
  BUILTIN_META_COMMAND_SPECS,
} from "./command-classify";
export {
  extractMentionArtifacts,
  mergeReferencedArtifacts,
} from "./mention-extract";
export { normalizeAttachments } from "./attachment-normalize";
