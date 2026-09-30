import {
  REQUEST_ENVELOPE_DEFAULTS,
  REQUEST_ENVELOPE_IDS,
  REQUEST_ENVELOPE_SCHEMA_VERSION,
} from "./constants";

import {
  userRequestEnvelopeSchema,
} from "./schema";

import type { CreateUserRequestInput } from "../contracts/input/CreateUserRequestInput";
import type {
  RequestArtifactReference,
  RequestImageAttachment,
  RequestMetaCommand,
  RequestSessionAction,
  RequestTurnKind,
  UserRequestCorrelation,
  UserRequestEnvelope,
  UserRequestEnvelopeBuilderDependencies,
  UserRequestWorkspaceScope,
} from "./types";
import type { AgentMode } from "../interaction-mode/types";

export interface BuildEnvelopeFields {
  mode: AgentMode;
  message: string;
  messageOriginal?: string;
  referencedArtifacts: RequestArtifactReference[];
  attachments?: RequestImageAttachment[];
  turnKind: RequestTurnKind;
  sessionAction?: RequestSessionAction;
  parentRequestId?: string;
  metaCommand?: RequestMetaCommand;
}

export class UserRequestEnvelopeBuilder {
  public readonly id =
    REQUEST_ENVELOPE_IDS
      .BUILDER;

  constructor(
    private readonly dependencies:
      UserRequestEnvelopeBuilderDependencies,
  ) {}

  public build(
    input:
      CreateUserRequestInput,
    overrides?: Partial<BuildEnvelopeFields>,
  ): UserRequestEnvelope {
    const requestId =
      input.requestId
        ?.trim() ||
      this.dependencies
        .idGenerator
        .generate(
          REQUEST_ENVELOPE_IDS
            .REQUEST_NAMESPACE,
        )
        .trim();

    const mode = overrides?.mode ?? input.mode;
    const message =
      overrides?.message ??
      input.userMessage.trim();
    const referencedArtifacts =
      overrides?.referencedArtifacts ??
      (input.referencedArtifacts ?? []).map((artifact) =>
        this.normalizeArtifact(artifact),
      );
    const attachments =
      overrides?.attachments ??
      input.attachments;
    const turnKind =
      overrides?.turnKind ??
      input.turnKind ??
      REQUEST_ENVELOPE_DEFAULTS.TURN_KIND;
    const sessionAction =
      overrides?.sessionAction ??
      input.sessionAction;
    const parentRequestId =
      overrides?.parentRequestId ??
      input.parentRequestId?.trim();
    const metaCommand =
      overrides?.metaCommand ??
      input.metaCommand;
    const messageOriginal =
      overrides?.messageOriginal;

    const result:
      UserRequestEnvelope = {
      schemaVersion:
        REQUEST_ENVELOPE_SCHEMA_VERSION,
      requestId,
      sessionId:
        input.sessionId
          .trim(),
      mode,
      origin:
        input.origin ??
        REQUEST_ENVELOPE_DEFAULTS
          .ORIGIN,
      message,
      referencedArtifacts:
        referencedArtifacts.map((artifact) =>
          this.normalizeArtifact(artifact),
        ),
      ...(input.workspace
        ? {
            workspace:
              this.normalizeWorkspace(
                input.workspace,
              ),
          }
        : {}),
      ...(input.correlation
        ? {
            correlation:
              this.normalizeCorrelation(
                input.correlation,
              ),
          }
        : {}),
      ...(attachments &&
      attachments.length >
        0
        ? {
            attachments,
          }
        : {}),
      ...(messageOriginal
        ? { messageOriginal }
        : {}),
      turnKind,
      ...(sessionAction
        ? { sessionAction }
        : {}),
      ...(parentRequestId
        ? { parentRequestId }
        : {}),
      ...(metaCommand
        ? { metaCommand }
        : {}),
      createdAt:
        this.toIsoDate(
          this.dependencies
            .clock
            .now(),
        ),
    };

    return userRequestEnvelopeSchema
      .parse(
        result,
      ) as UserRequestEnvelope;
  }

  private normalizeArtifact(
    artifact:
      RequestArtifactReference,
  ): RequestArtifactReference {
    const name =
      artifact.name.trim();
    const path =
      artifact.path
        ?.trim();
    const extension =
      this.normalizeExtension(
        artifact.extension,
        path ??
        name,
      );

    return {
      ...(artifact.id
        ?.trim()
        ? {
            id:
              artifact.id
                .trim(),
          }
        : {}),
      name,
      ...(path
        ? {
            path,
          }
        : {}),
      kind:
        artifact.kind,
      ...(extension
        ? {
            extension,
          }
        : {}),
      ...(artifact.language
        ?.trim()
        ? {
            language:
              artifact.language
                .trim()
                .toLowerCase(),
          }
        : {}),
      ...(artifact.contentHash
        ?.trim()
        ? {
            contentHash:
              artifact.contentHash
                .trim(),
          }
        : {}),
      ...(artifact.startLine !==
      undefined
        ? {
            startLine:
              artifact
                .startLine,
          }
        : {}),
      ...(artifact.endLine !==
      undefined
        ? {
            endLine:
              artifact
                .endLine,
          }
        : {}),
    };
  }

  private normalizeWorkspace(
    workspace:
      UserRequestWorkspaceScope,
  ): UserRequestWorkspaceScope {
    return {
      workspaceId:
        workspace
          .workspaceId
          .trim(),
      ...(workspace.rootIds
        ? {
            rootIds:
              workspace.rootIds
                .map(
                  (rootId) =>
                    rootId.trim(),
                ),
          }
        : {}),
      ...(workspace
        .observedSnapshotId
        ?.trim()
        ? {
            observedSnapshotId:
              workspace
                .observedSnapshotId
                .trim(),
          }
        : {}),
      ...(workspace
        .observedCodeIndexChangeToken
        ?.trim()
        ? {
            observedCodeIndexChangeToken:
              workspace
                .observedCodeIndexChangeToken
                .trim(),
          }
        : {}),
    };
  }

  private normalizeCorrelation(
    correlation:
      UserRequestCorrelation,
  ): UserRequestCorrelation {
    return {
      ...(correlation.traceId
        ?.trim()
        ? {
            traceId:
              correlation
                .traceId
                .trim(),
          }
        : {}),
      ...(correlation
        .clientRequestId
        ?.trim()
        ? {
            clientRequestId:
              correlation
                .clientRequestId
                .trim(),
          }
        : {}),
    };
  }

  private normalizeExtension(
    extension:
      string |
      undefined,
    pathOrName: string,
  ): string | undefined {
    const supplied =
      extension
        ?.trim()
        .toLowerCase();

    if (supplied) {
      return supplied
        .startsWith(".")
        ? supplied
        : `.${supplied}`;
    }

    const finalSegment =
      pathOrName
        .replace(
          /\\/g,
          "/",
        )
        .split("/")
        .pop() ??
      "";
    const index =
      finalSegment
        .lastIndexOf(".");

    if (
      index <= 0 ||
      index ===
        finalSegment
          .length -
          1
    ) {
      return undefined;
    }

    return finalSegment
      .slice(index)
      .toLowerCase();
  }

  private toIsoDate(
    milliseconds: number,
  ): string {
    if (
      !Number.isFinite(
        milliseconds,
      )
    ) {
      throw new RangeError(
        "Request envelope clock must return finite epoch milliseconds.",
      );
    }

    return new Date(
      milliseconds,
    ).toISOString();
  }
}
