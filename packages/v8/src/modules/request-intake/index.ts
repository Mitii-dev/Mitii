export { UserRequestEnvelopeBuilder } from "./request-envelope/UserRequestEnvelopeBuilder";
export type { CreateUserRequestInput } from "./contracts/input/CreateUserRequestInput";
export type {
  UserRequestEnvelope,
  UserRequestEnvelopeBuilderDependencies,
  RequestArtifactReference,
  RequestArtifactKind,
  UserRequestCorrelation,
  UserRequestOrigin,
  UserRequestWorkspaceScope,
} from "./request-envelope/types";
export {
  userRequestEnvelopeSchema,
  requestArtifactReferenceSchema,
} from "./request-envelope/schema";

export { agentModeSchema } from "./interaction-mode/schema";
export type { AgentMode } from "./interaction-mode/types";
export { AGENT_MODES, INTERACTION_MODE_DEFAULT } from "./interaction-mode/constants";

export {
  createUserRequestInputSchema,
} from "./contracts";

export { RequestIntakePipeline } from "./pipeline/RequestIntakePipeline";
export type { RequestIntakePipelineDependencies } from "./pipeline/RequestIntakePipeline";
