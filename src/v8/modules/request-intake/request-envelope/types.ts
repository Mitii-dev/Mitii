import type {
  AgentMode,
} from "../interaction-mode";

export type UserRequestOrigin =
  | "user"
  | "automation"
  | "api";

export type RequestArtifactKind =
  | "file"
  | "folder"
  | "attachment"
  | "selection"
  | "symbol";

export interface RequestArtifactReference {
  id?: string;

  name: string;
  path?: string;
  kind: RequestArtifactKind;

  extension?: string;
  language?: string;
  contentHash?: string;

  startLine?: number;
  endLine?: number;
}

export interface UserRequestWorkspaceScope {
  workspaceId: string;
  rootIds?: readonly string[];

  /**
   * Repository state visible when the request was submitted.
   *
   * Both values are optional because initial workspace discovery may
   * occur after request creation.
   */
  observedSnapshotId?: string;
  observedCodeIndexChangeToken?: string;
}

export interface UserRequestCorrelation {
  traceId?: string;
  clientRequestId?: string;
}

export interface UserRequestEnvelope {
  schemaVersion: 1;

  requestId: string;
  sessionId: string;

  mode: AgentMode;
  origin: UserRequestOrigin;

  message: string;
  referencedArtifacts: RequestArtifactReference[];

  workspace?: UserRequestWorkspaceScope;
  correlation?: UserRequestCorrelation;

  createdAt: string;
}

export interface CreateUserRequestInput {
  requestId?: string;
  sessionId: string;

  mode: AgentMode;
  origin?: UserRequestOrigin;

  userMessage: string;
  referencedArtifacts?: readonly RequestArtifactReference[];

  workspace?: UserRequestWorkspaceScope;
  correlation?: UserRequestCorrelation;
}

export interface RequestEnvelopeClockPort {
  now(): number;
}

export interface RequestEnvelopeIdGeneratorPort {
  generate(namespace: string): string;
}

export interface UserRequestEnvelopeBuilderDependencies {
  clock: RequestEnvelopeClockPort;
  idGenerator: RequestEnvelopeIdGeneratorPort;
}
