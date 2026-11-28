import {
  REPOSITORY_STATE_MESSAGES,
  REPOSITORY_STATE_STAGES,
} from "../constants";
import { pinRepositoryStateInputSchema } from "../contracts/input/ReadRepositoryStateInput";
import { readRepositoryStateInputSchema } from "../contracts/input/ReadRepositoryStateInput";
import { unpinRepositoryStateInputSchema } from "../contracts/input/ReadRepositoryStateInput";
import type { PublishRepositoryStateInput } from "../contracts/input/PublishRepositoryStateInput";
import type {
  PinRepositoryStateInput,
  ReadRepositoryStateInput,
  UnpinRepositoryStateInput,
} from "../contracts/input/ReadRepositoryStateInput";
import { RepositoryStateError } from "../contracts/errors/RepositoryStateError";
import {
  pinRepositoryStateResultSchema,
  publishRepositoryStateResultSchema,
  readRepositoryStateResultSchema,
  unpinRepositoryStateResultSchema,
} from "../contracts/output/RepositoryStateResults";
import type {
  PinRepositoryStateResult,
  PublishRepositoryStateResult,
  ReadRepositoryStateResult,
  UnpinRepositoryStateResult,
} from "../contracts/output/RepositoryStateResults";
import type { RepositoryStateDescriptor } from "../contracts/output/RepositoryStateDescriptor";
import { buildPublishCandidateFromIndexing } from "../helpers/buildPublishCandidateFromIndexing";
import {
  noopModuleLogger,
  type ModuleLoggerPort,
} from "../ports/ModuleLoggerPort";
import type { RepositoryStateStorePort } from "../ports/RepositoryStateStorePorts";
import { parseCandidateStep } from "./steps/1-parse-candidate";
import { buildDescriptorStep } from "./steps/2-build-descriptor";
import { persistDescriptorStep } from "./steps/3-persist-descriptor";
import { finalizePublishStep } from "./steps/4-finalize-publish";
import type { WorkspaceIndexingPipelineResult } from "./ws-indexing-pipeline/types";

export interface RepositoryStatePipelineClock {
  now(): Date;
}

export interface RepositoryStatePipelineDependencies {
  store: RepositoryStateStorePort;
  clock?: RepositoryStatePipelineClock;
  log?: ModuleLoggerPort;
}

/**
 * Primary Repository State facade: validate candidates, derive stateToken,
 * atomically publish immutable descriptors, and pin state for active runs.
 *
 * Flow (publish):
 *   1-parse-candidate → 2-build-descriptor → 3-persist-descriptor → 4-finalize-publish
 */
export class RepositoryStatePipeline {
  private readonly store: RepositoryStateStorePort;
  private readonly clock: RepositoryStatePipelineClock;
  private readonly log: ModuleLoggerPort;

  constructor(dependencies: RepositoryStatePipelineDependencies) {
    this.store = dependencies.store;
    this.clock = dependencies.clock ?? {
      now: () => new Date(),
    };
    this.log = dependencies.log ?? noopModuleLogger;
  }

  public async publish(
    input: PublishRepositoryStateInput,
    options: { abortSignal?: AbortSignal } = {},
  ): Promise<PublishRepositoryStateResult> {
    if (options.abortSignal?.aborted) {
      return publishRepositoryStateResultSchema.parse({
        status: "cancelled",
        code: "publication_cancelled",
        message: REPOSITORY_STATE_MESSAGES.publicationCancelled,
      });
    }

    let stageStartedMs = Date.now();
    const parsed = parseCandidateStep(input);
    this.log.stage({
      module: "repository-state",
      stage: REPOSITORY_STATE_STAGES.parseCandidate,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: parsed.ok ? [] : ["invalid_candidate"],
      outputSummary: { ok: parsed.ok },
    });
    if (!parsed.ok) {
      return parsed.result;
    }

    const generatedAt =
      parsed.candidate.generatedAt ?? this.clock.now().toISOString();

    stageStartedMs = Date.now();
    const descriptor = buildDescriptorStep({
      candidate: parsed.candidate,
      generatedAt,
    });
    this.log.stage({
      module: "repository-state",
      stage: REPOSITORY_STATE_STAGES.buildDescriptor,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: descriptor.reasons.map((reason) => reason.code),
      outputSummary: {
        readiness: descriptor.readiness,
        rootCount: descriptor.roots.length,
      },
    });

    if (options.abortSignal?.aborted) {
      return publishRepositoryStateResultSchema.parse({
        status: "cancelled",
        code: "publication_cancelled",
        message: REPOSITORY_STATE_MESSAGES.publicationCancelled,
      });
    }

    stageStartedMs = Date.now();
    const persisted = await persistDescriptorStep({
      store: this.store,
      descriptor,
    });
    this.log.stage({
      module: "repository-state",
      stage: REPOSITORY_STATE_STAGES.persistDescriptor,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes:
        persisted.ok || persisted.result.status !== "failed"
          ? []
          : [persisted.result.code],
      outputSummary: { ok: persisted.ok },
    });
    if (!persisted.ok) {
      return persisted.result;
    }

    stageStartedMs = Date.now();
    const result = finalizePublishStep(descriptor);
    this.log.stage({
      module: "repository-state",
      stage: REPOSITORY_STATE_STAGES.finalizePublish,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        workspaceId:
          result.status === "published"
            ? result.reference.workspaceId
            : undefined,
        stateToken:
          result.status === "published"
            ? result.reference.stateToken
            : undefined,
      },
    });
    return result;
  }

  /**
   * Publish repository state from a completed WorkspaceIndexingPipeline run.
   * Indexing remains the candidate producer; this facade remains the authority.
   */
  public async publishFromIndexing(
    indexing: WorkspaceIndexingPipelineResult,
    options: {
      abortSignal?: AbortSignal;
      catalogRevisionByRoot?: Readonly<Record<string, string>>;
      graphRevisionByRoot?: Readonly<Record<string, string>>;
      mapRevisionByRoot?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<PublishRepositoryStateResult> {
    const built = buildPublishCandidateFromIndexing(indexing, {
      catalogRevisionByRoot: options.catalogRevisionByRoot,
      graphRevisionByRoot: options.graphRevisionByRoot,
      mapRevisionByRoot: options.mapRevisionByRoot,
    });
    if (built.status === "failed") {
      return publishRepositoryStateResultSchema.parse({
        status: "failed",
        code: built.code,
        message: built.message,
      });
    }

    return this.publish(built.candidate, {
      abortSignal: options.abortSignal,
    });
  }

  public async read(
    input: ReadRepositoryStateInput,
  ): Promise<ReadRepositoryStateResult> {
    const stageStartedMs = Date.now();
    const reference = readRepositoryStateInputSchema.parse(input);
    const descriptor = await this.store.read(reference);

    if (!descriptor) {
      const result = readRepositoryStateResultSchema.parse({
        status: "not_found",
        code: "unknown_state_token",
        message: REPOSITORY_STATE_MESSAGES.unknownStateToken,
      });
      this.log.stage({
        module: "repository-state",
        stage: REPOSITORY_STATE_STAGES.read,
        durationMs: Date.now() - stageStartedMs,
        reasonCodes: ["unknown_state_token"],
        outputSummary: { status: "not_found" },
      });
      return result;
    }

    if (descriptor.workspaceId !== reference.workspaceId) {
      const result = readRepositoryStateResultSchema.parse({
        status: "not_found",
        code: "workspace_mismatch",
        message: REPOSITORY_STATE_MESSAGES.workspaceMismatch,
      });
      this.log.stage({
        module: "repository-state",
        stage: REPOSITORY_STATE_STAGES.read,
        durationMs: Date.now() - stageStartedMs,
        reasonCodes: ["workspace_mismatch"],
        outputSummary: { status: "not_found" },
      });
      return result;
    }

    const result = readRepositoryStateResultSchema.parse({
      status: "found",
      descriptor,
    });
    this.log.stage({
      module: "repository-state",
      stage: REPOSITORY_STATE_STAGES.read,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { status: "found", readiness: descriptor.readiness },
    });
    return result;
  }

  public async getLatest(
    workspaceId: string,
  ): Promise<RepositoryStateDescriptor | undefined> {
    return this.store.getLatest(workspaceId);
  }

  public async pin(
    input: PinRepositoryStateInput,
  ): Promise<PinRepositoryStateResult> {
    const stageStartedMs = Date.now();
    const parsed = pinRepositoryStateInputSchema.parse(input);
    const existing = await this.store.read(parsed.state);

    if (!existing) {
      const result = pinRepositoryStateResultSchema.parse({
        status: "failed",
        code: "unknown_state_token",
        message: REPOSITORY_STATE_MESSAGES.cannotPinUnknown,
      });
      this.log.stage({
        module: "repository-state",
        stage: REPOSITORY_STATE_STAGES.pin,
        durationMs: Date.now() - stageStartedMs,
        reasonCodes: ["unknown_state_token"],
        outputSummary: { status: "failed" },
      });
      return result;
    }

    if (existing.workspaceId !== parsed.state.workspaceId) {
      const result = pinRepositoryStateResultSchema.parse({
        status: "failed",
        code: "workspace_mismatch",
        message: REPOSITORY_STATE_MESSAGES.workspaceMismatch,
      });
      this.log.stage({
        module: "repository-state",
        stage: REPOSITORY_STATE_STAGES.pin,
        durationMs: Date.now() - stageStartedMs,
        reasonCodes: ["workspace_mismatch"],
        outputSummary: { status: "failed" },
      });
      return result;
    }

    await this.store.pin(parsed.state, parsed.runId);

    const result = pinRepositoryStateResultSchema.parse({
      status: "pinned",
      reference: parsed.state,
      runId: parsed.runId,
    });
    this.log.stage({
      module: "repository-state",
      stage: REPOSITORY_STATE_STAGES.pin,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: ["state_pinned"],
      outputSummary: { status: "pinned", runId: parsed.runId },
    });
    return result;
  }

  public async unpin(
    input: UnpinRepositoryStateInput,
  ): Promise<UnpinRepositoryStateResult> {
    const stageStartedMs = Date.now();
    const parsed = unpinRepositoryStateInputSchema.parse(input);

    try {
      await this.store.unpin(parsed.state, parsed.runId);
    } catch (error) {
      if (
        error instanceof RepositoryStateError &&
        error.code === "state_not_found"
      ) {
        const result = unpinRepositoryStateResultSchema.parse({
          status: "failed",
          code: "state_not_found",
          message: error.message,
        });
        this.log.stage({
          module: "repository-state",
          stage: REPOSITORY_STATE_STAGES.unpin,
          durationMs: Date.now() - stageStartedMs,
          reasonCodes: ["state_not_found"],
          outputSummary: { status: "failed" },
        });
        return result;
      }
      throw error;
    }

    const result = unpinRepositoryStateResultSchema.parse({
      status: "unpinned",
      reference: parsed.state,
      runId: parsed.runId,
    });
    this.log.stage({
      module: "repository-state",
      stage: REPOSITORY_STATE_STAGES.unpin,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: { status: "unpinned", runId: parsed.runId },
    });
    return result;
  }
}
