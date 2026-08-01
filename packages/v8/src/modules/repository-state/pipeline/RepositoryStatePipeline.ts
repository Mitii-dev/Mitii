import {
  publishRepositoryStateInputSchema,
} from "../contracts/input/PublishRepositoryStateInput";
import type {
  PublishRepositoryStateInput,
} from "../contracts/input/PublishRepositoryStateInput";
import {
  pinRepositoryStateInputSchema,
  readRepositoryStateInputSchema,
  unpinRepositoryStateInputSchema,
} from "../contracts/input/ReadRepositoryStateInput";
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
import type {
  RepositoryStateDescriptor,
} from "../contracts/output/RepositoryStateDescriptor";
import type {
  RepositoryStateStorePort,
} from "../contracts/ports/RepositoryStateStorePorts";
import { buildPublishCandidateFromIndexing } from "../actions/buildPublishCandidateFromIndexing";
import { buildDescriptor } from "../internal/state-publication/buildDescriptor";
import type {
  WorkspaceIndexingPipelineResult,
} from "./ws-indexing-pipeline/types";

export interface RepositoryStatePipelineClock {
  now(): Date;
}

export interface RepositoryStatePipelineDependencies {
  store: RepositoryStateStorePort;
  clock?: RepositoryStatePipelineClock;
}

/**
 * Primary Repository State facade: validate candidates, derive stateToken,
 * atomically publish immutable descriptors, and pin state for active runs.
 */
export class RepositoryStatePipeline {
  private readonly store: RepositoryStateStorePort;
  private readonly clock: RepositoryStatePipelineClock;

  constructor(dependencies: RepositoryStatePipelineDependencies) {
    this.store = dependencies.store;
    this.clock = dependencies.clock ?? {
      now: () => new Date(),
    };
  }

  public async publish(
    input: PublishRepositoryStateInput,
    options: { abortSignal?: AbortSignal } = {},
  ): Promise<PublishRepositoryStateResult> {
    if (options.abortSignal?.aborted) {
      return publishRepositoryStateResultSchema.parse({
        status: "cancelled",
        code: "publication_cancelled",
        message: "Repository state publication was cancelled.",
      });
    }

    let candidate: PublishRepositoryStateInput;
    try {
      candidate = publishRepositoryStateInputSchema.parse(input);
    } catch (error) {
      return publishRepositoryStateResultSchema.parse({
        status: "failed",
        code: "invalid_candidate",
        message:
          error instanceof Error
            ? error.message
            : "Invalid repository state candidate.",
      });
    }

    const generatedAt =
      candidate.generatedAt ?? this.clock.now().toISOString();

    const descriptor = buildDescriptor({
      candidate,
      generatedAt,
    });

    if (options.abortSignal?.aborted) {
      return publishRepositoryStateResultSchema.parse({
        status: "cancelled",
        code: "publication_cancelled",
        message: "Repository state publication was cancelled.",
      });
    }

    try {
      await this.store.publish(descriptor);
    } catch (error) {
      if (error instanceof RepositoryStateError) {
        return publishRepositoryStateResultSchema.parse({
          status: "failed",
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    return publishRepositoryStateResultSchema.parse({
      status: "published",
      reference: {
        workspaceId: descriptor.workspaceId,
        stateToken: descriptor.stateToken,
      },
      descriptor,
    });
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
    const reference = readRepositoryStateInputSchema.parse(input);
    const descriptor = await this.store.read(reference);

    if (!descriptor) {
      return readRepositoryStateResultSchema.parse({
        status: "not_found",
        code: "unknown_state_token",
        message: "No published repository state matches the state token.",
      });
    }

    if (descriptor.workspaceId !== reference.workspaceId) {
      return readRepositoryStateResultSchema.parse({
        status: "not_found",
        code: "workspace_mismatch",
        message: "State token does not belong to the requested workspace.",
      });
    }

    return readRepositoryStateResultSchema.parse({
      status: "found",
      descriptor,
    });
  }

  public async getLatest(
    workspaceId: string,
  ): Promise<RepositoryStateDescriptor | undefined> {
    return this.store.getLatest(workspaceId);
  }

  public async pin(
    input: PinRepositoryStateInput,
  ): Promise<PinRepositoryStateResult> {
    const parsed = pinRepositoryStateInputSchema.parse(input);
    const existing = await this.store.read(parsed.state);

    if (!existing) {
      return pinRepositoryStateResultSchema.parse({
        status: "failed",
        code: "unknown_state_token",
        message: "Cannot pin an unknown repository state token.",
      });
    }

    if (existing.workspaceId !== parsed.state.workspaceId) {
      return pinRepositoryStateResultSchema.parse({
        status: "failed",
        code: "workspace_mismatch",
        message: "State token does not belong to the requested workspace.",
      });
    }

    await this.store.pin(parsed.state, parsed.runId);

    return pinRepositoryStateResultSchema.parse({
      status: "pinned",
      reference: parsed.state,
      runId: parsed.runId,
    });
  }

  public async unpin(
    input: UnpinRepositoryStateInput,
  ): Promise<UnpinRepositoryStateResult> {
    const parsed = unpinRepositoryStateInputSchema.parse(input);

    try {
      await this.store.unpin(parsed.state, parsed.runId);
    } catch (error) {
      if (
        error instanceof RepositoryStateError &&
        error.code === "state_not_found"
      ) {
        return unpinRepositoryStateResultSchema.parse({
          status: "failed",
          code: "state_not_found",
          message: error.message,
        });
      }
      throw error;
    }

    return unpinRepositoryStateResultSchema.parse({
      status: "unpinned",
      reference: parsed.state,
      runId: parsed.runId,
    });
  }
}
