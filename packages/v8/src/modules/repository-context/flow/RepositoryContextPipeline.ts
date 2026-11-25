import {
  REPOSITORY_CONTEXT_PIPELINE_IDS,
  REPOSITORY_CONTEXT_REASON,
  REPOSITORY_CONTEXT_STAGES,
} from "../constants";
import {
  repositoryContextPipelineInputSchema,
} from "../contracts/schema";
import type {
  RepositoryContextPipelineDependencies,
  RepositoryContextPipelineInput,
  RepositoryContextPipelineResult,
  ModuleLoggerPort,
} from "../contracts/types";
import { noopModuleLogger } from "../ports/ModuleLoggerPort";
import { resolveRepositoryContextState } from "./steps/1-resolve-state";
import { prepareRepositoryContextRetrieval } from "./steps/2-prepare-retrieval";
import { retrieveRepositoryContext } from "./steps/3-retrieve";
import { selectRepositoryContext } from "./steps/4-select";
import { assembleRepositoryContext } from "./steps/5-assemble";
import {
  buildFailedRepositoryContextResult,
  finalizeRepositoryContextResult,
} from "./steps/6-finalize-result";

export type RepositoryContextPipelineOptions = {
  log?: ModuleLoggerPort;
};

/**
 * Primary Repository Context facade.
 *
 * Flow (execute):
 *   1-resolve-state → 2-prepare-retrieval → 3-retrieve
 *   → 4-select → 5-assemble → 6-finalize-result
 *
 * Accepts only a published state reference; artifacts are resolved through
 * the injected state resolver so callers cannot mix independent revisions.
 */
export class RepositoryContextPipeline {
  public readonly id = REPOSITORY_CONTEXT_PIPELINE_IDS.PIPELINE;
  private readonly log: ModuleLoggerPort;

  constructor(
    private readonly dependencies: RepositoryContextPipelineDependencies,
    options: RepositoryContextPipelineOptions = {},
  ) {
    this.log = options.log ?? noopModuleLogger;
  }

  public async execute(
    rawInput: RepositoryContextPipelineInput,
  ): Promise<RepositoryContextPipelineResult> {
    const input = repositoryContextPipelineInputSchema.parse(
      rawInput,
    ) as RepositoryContextPipelineInput;

    let stageStartedMs = Date.now();
    const resolved = await resolveRepositoryContextState({
      input,
      stateResolver: this.dependencies.stateResolver,
    });
    this.log.stage({
      module: "repository-context",
      stage: REPOSITORY_CONTEXT_STAGES.resolveState,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes:
        resolved.status === "ok"
          ? [REPOSITORY_CONTEXT_REASON.stateResolved]
          : [REPOSITORY_CONTEXT_REASON.stateFailed],
      outputSummary: { status: resolved.status },
    });

    if (resolved.status === "failed") {
      return buildFailedRepositoryContextResult({
        input,
        stateToken: resolved.stateToken,
        workspaceSnapshotId: resolved.workspaceSnapshotId,
        warnings: resolved.warnings,
      });
    }

    const { artifacts, warnings } = resolved;

    stageStartedMs = Date.now();
    const prepared = prepareRepositoryContextRetrieval({ input, artifacts });
    this.log.stage({
      module: "repository-context",
      stage: REPOSITORY_CONTEXT_STAGES.prepareRetrieval,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        anchorCount: prepared.anchorFilePaths.length,
        hasRankingContext: Boolean(prepared.rankingContext),
      },
    });

    stageStartedMs = Date.now();
    const retrieval = await retrieveRepositoryContext({
      input,
      artifacts,
      prepared,
      retriever: this.dependencies.retriever,
    });
    this.log.stage({
      module: "repository-context",
      stage: REPOSITORY_CONTEXT_STAGES.retrieve,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        status: retrieval.status,
        candidateCount: retrieval.candidates.length,
      },
    });

    stageStartedMs = Date.now();
    const selection = selectRepositoryContext({
      input,
      retrieval,
      prepared,
      selector: this.dependencies.selector,
    });
    this.log.stage({
      module: "repository-context",
      stage: REPOSITORY_CONTEXT_STAGES.select,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        status: selection.status,
        selectedItems: selection.items.length,
      },
    });

    stageStartedMs = Date.now();
    const assembly = await assembleRepositoryContext({
      input,
      artifacts,
      selection,
      assembler: this.dependencies.assembler,
    });
    this.log.stage({
      module: "repository-context",
      stage: REPOSITORY_CONTEXT_STAGES.assemble,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        status: assembly.status,
        blockCount: assembly.blocks.length,
        usedTokens: assembly.budget.usedTokens,
      },
    });

    stageStartedMs = Date.now();
    const result = finalizeRepositoryContextResult({
      input,
      artifacts,
      retrieval,
      selection,
      assembly,
      warnings,
    });
    this.log.stage({
      module: "repository-context",
      stage: REPOSITORY_CONTEXT_STAGES.finalizeResult,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [result.status],
      outputSummary: {
        status: result.status,
        warningCount: result.warnings.length,
      },
    });

    return result;
  }
}
