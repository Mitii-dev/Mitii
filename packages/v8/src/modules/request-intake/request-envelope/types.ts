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

/**
 * How this intake relates to an in-flight or prior turn.
 * Hosts set this; intake defaults to `new`.
 */
export type RequestTurnKind =
  | "new"
  | "continue"
  | "steer"
  | "follow_up"
  | "recover";

/**
 * Session-level action requested at the intake boundary.
 * Classification only — session storage stays with the host.
 */
export type RequestSessionAction =
  | "continue"
  | "new"
  | "resume";

/**
 * Lifecycle for a classified leading slash command.
 * Intake never executes the command — it only labels how the host/engine
 * should participate in the turn.
 */
export type MetaCommandLifecycle =
  | "side_channel"
  | "stop"
  | "finalize"
  | "agent_turn"
  | "agent_turn_with_args";

export interface RequestMetaCommand {
  name: string;
  args: string;
  lifecycle: MetaCommandLifecycle;
}

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

export type SupportedImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

export interface RequestImageAttachment {
  mimeType: SupportedImageMimeType;
  data: string;
  name?: string;
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
  attachments?: RequestImageAttachment[];

  /** Present when intake mutated the message (mode/command strip). */
  messageOriginal?: string;

  turnKind: RequestTurnKind;
  sessionAction?: RequestSessionAction;
  parentRequestId?: string;

  /**
   * Leading slash command classified at intake.
   * Non-agent lifecycles should short-circuit before understand/pin work.
   */
  metaCommand?: RequestMetaCommand;

  createdAt: string;
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
