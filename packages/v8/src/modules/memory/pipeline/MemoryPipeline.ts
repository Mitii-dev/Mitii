import {
  applyMemoryBudget,
  commitMemory,
  consolidateMemory,
  estimateTokens,
  filterMemoryCandidates,
  scoreMemoryRelevance,
} from "../actions";
import {
  MEMORY_MESSAGES,
  MEMORY_REASON,
  MEMORY_SCHEMA_VERSION,
  MEMORY_STAGES,
} from "../constants";
import {
  MemoryError,
  memoryFactSchema,
  memoryRetrieveInputSchema,
  memoryRetrieveResultSchema,
  noopModuleLogger,
} from "../contracts";
import type {
  MemoryCommitInput,
  MemoryCommitResult,
  MemoryConsolidateInput,
  MemoryConsolidateResult,
  MemoryEmbeddingPort,
  MemoryFact,
  MemoryIdGeneratorPort,
  MemoryReasonCode,
  MemoryRetrieveInput,
  MemoryRetrieveParsedInput,
  MemoryRetrieveResult,
  MemoryStorePort,
  ModuleLoggerPort,
} from "../contracts";
import { buildWorkspaceProfile } from "../internal/profile";
import { MEMORY_THRESHOLDS } from "../policy";

export interface MemoryPipelineDependencies {
  store: MemoryStorePort;
  idGenerator?: MemoryIdGeneratorPort;
  embedding?: MemoryEmbeddingPort;
  log?: ModuleLoggerPort;
}

/**
 * Memory facade.
 *
 * Flow (retrieve):
 *   validate → query store → 1-filter → 2-score → 3-budget
 *   → optional workspace profile → access touch
 *   → optional layered partition (mode=layered)
 *
 * Flow (commit / consolidate):
 *   validate → 4-prepare → 5-persist via store port
 *
 * Does not own run orchestration or general prompt construction.
 */
export class MemoryPipeline {
  private readonly store: MemoryStorePort;
  private readonly idGenerator: MemoryIdGeneratorPort;
  private readonly embedding?: MemoryEmbeddingPort;
  private readonly log: ModuleLoggerPort;

  constructor(dependencies: MemoryPipelineDependencies) {
    if (!dependencies.store) {
      throw new MemoryError(
        "misconfigured_ports",
        MEMORY_MESSAGES.storeRequired,
      );
    }
    this.store = dependencies.store;
    this.embedding = dependencies.embedding;
    this.log = dependencies.log ?? noopModuleLogger;
    this.idGenerator = dependencies.idGenerator ?? {
      next: (prefix: string) =>
        `${prefix}_${Math.random().toString(36).slice(2, 10)}`,
    };
  }

  public async retrieve(
    input: MemoryRetrieveInput,
  ): Promise<MemoryRetrieveResult> {
    const startedMs = Date.now();

    let parsed: MemoryRetrieveParsedInput;
    try {
      parsed = memoryRetrieveInputSchema.parse(input);
    } catch (error) {
      throw new MemoryError(
        "invalid_input",
        MEMORY_MESSAGES.retrieveInputInvalid,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const now = parsed.now ? new Date(parsed.now) : new Date();
    const reasonCodes: MemoryReasonCode[] = [];
    const warnings: string[] = [];

    let rawFacts;
    try {
      rawFacts = await this.store.query({
        scope: parsed.scope,
        query: parsed.query,
      });
    } catch (error) {
      throw new MemoryError(
        "store_failed",
        MEMORY_MESSAGES.storeQueryFailed,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const facts = rawFacts.map((fact) => memoryFactSchema.parse(fact));
    if (facts.length === 0) {
      reasonCodes.push(MEMORY_REASON.storeEmpty);
      return memoryRetrieveResultSchema.parse({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        status: "empty",
        instructions: [],
        omissions: [],
        usedTokens: 0,
        budgetTokens: parsed.budgetTokens,
        warnings,
        reasonCodes,
        durationMs: Date.now() - startedMs,
      });
    }

    let stageStartedMs = Date.now();
    const filtered = filterMemoryCandidates({
      facts,
      scope: parsed.scope,
      requesterUserId: parsed.requesterUserId,
      now,
      origin: parsed.origin,
    });
    if (filtered.staleFiltered) {
      reasonCodes.push(MEMORY_REASON.staleFiltered);
    }
    if (filtered.privacyFiltered) {
      reasonCodes.push(MEMORY_REASON.privacyFiltered);
    }
    if (filtered.supersededFiltered) {
      reasonCodes.push(MEMORY_REASON.superseded);
    }
    this.log.stage({
      module: "memory",
      stage: MEMORY_STAGES.filterCandidates,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: reasonCodes.slice(),
      inputSummary: { factCount: facts.length },
      outputSummary: {
        candidates: filtered.candidates.length,
        omissions: filtered.omissions.length,
      },
    });

    stageStartedMs = Date.now();
    const ranked = await scoreMemoryRelevance({
      facts: filtered.candidates,
      query: parsed.query,
      fileTargets: parsed.fileTargets,
      concepts: parsed.concepts,
      maxFacts: parsed.maxFacts,
      now,
      embedding: this.embedding,
      signal: parsed.signal,
    });
    if (ranked.embeddingWarning) {
      warnings.push(ranked.embeddingWarning);
    }
    this.log.stage({
      module: "memory",
      stage: MEMORY_STAGES.scoreRelevance,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: [],
      outputSummary: {
        scored: ranked.scored.length,
        hybrid: ranked.hybrid,
        fileBoosted: ranked.fileBoosted,
      },
    });

    const irrelevant = filtered.candidates
      .filter(
        (fact) => !ranked.scored.some((entry) => entry.fact.id === fact.id),
      )
      .map((fact) => ({
        memoryId: fact.id,
        reason: "irrelevant" as const,
      }));

    if (parsed.mode === "layered") {
      stageStartedMs = Date.now();
      const layered = buildLayeredInstructions({
        scored: ranked.scored,
        budgetTokens: parsed.budgetTokens,
        maxFacts: parsed.maxFacts,
      });
      const omissions = [
        ...filtered.omissions,
        ...irrelevant,
        ...layered.omissions,
      ];
      this.log.stage({
        module: "memory",
        stage: MEMORY_STAGES.applyBudget,
        durationMs: Date.now() - stageStartedMs,
        reasonCodes: [],
        outputSummary: {
          mode: "layered",
          instructions: layered.instructions.length,
          budgetOmitted: layered.budgetOmitted,
        },
      });

      if (layered.instructions.length === 0) {
        reasonCodes.push(MEMORY_REASON.noRelevant);
        return memoryRetrieveResultSchema.parse({
          schemaVersion: MEMORY_SCHEMA_VERSION,
          status: "empty",
          instructions: [],
          omissions,
          usedTokens: 0,
          budgetTokens: parsed.budgetTokens,
          warnings,
          reasonCodes: unique(reasonCodes),
          durationMs: Date.now() - startedMs,
          layers: layered.layers,
        });
      }

      reasonCodes.push(MEMORY_REASON.retrieved, MEMORY_REASON.layered);
      pushRankReasons(reasonCodes, ranked);
      if (layered.budgetOmitted) {
        reasonCodes.push(MEMORY_REASON.budgetOmitted);
      }

      if (!parsed.deferAccess) {
        await this.touchAccess(
          layered.instructions
            .map((block) => block.id)
            .filter((id) => !id.startsWith("mem-l") && id !== MEMORY_PROFILE_ID),
          now.toISOString(),
          warnings,
        );
      }

      return memoryRetrieveResultSchema.parse({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        status: "retrieved",
        instructions: layered.instructions,
        omissions,
        usedTokens: layered.instructions.reduce(
          (sum, block) => sum + estimateTokens(block.content),
          0,
        ),
        budgetTokens: parsed.budgetTokens,
        warnings,
        reasonCodes: unique(reasonCodes),
        durationMs: Date.now() - startedMs,
        layers: layered.layers,
      });
    }

    stageStartedMs = Date.now();
    const budgeted = applyMemoryBudget({
      scored: ranked.scored,
      budgetTokens: parsed.budgetTokens,
      maxFacts: parsed.maxFacts,
    });

    if (budgeted.budgetOmitted) {
      reasonCodes.push(MEMORY_REASON.budgetOmitted);
    }

    appendWorkspaceProfile({
      instructions: budgeted.instructions,
      candidates: filtered.candidates,
      budgetTokens: parsed.budgetTokens,
      maxFacts: parsed.maxFacts,
      usedTokens: budgeted.usedTokens,
      now,
    });

    this.log.stage({
      module: "memory",
      stage: MEMORY_STAGES.applyBudget,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: budgeted.budgetOmitted
        ? [MEMORY_REASON.budgetOmitted]
        : [],
      outputSummary: {
        mode: "flat",
        instructions: budgeted.instructions.length,
        usedTokens: budgeted.usedTokens,
      },
    });

    const omissions = [
      ...filtered.omissions,
      ...irrelevant,
      ...budgeted.omissions,
    ];

    if (budgeted.instructions.length === 0) {
      reasonCodes.push(MEMORY_REASON.noRelevant);
      return memoryRetrieveResultSchema.parse({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        status: "empty",
        instructions: [],
        omissions,
        usedTokens: 0,
        budgetTokens: parsed.budgetTokens,
        warnings,
        reasonCodes: unique(reasonCodes),
        durationMs: Date.now() - startedMs,
      });
    }

    reasonCodes.push(MEMORY_REASON.retrieved);
    pushRankReasons(reasonCodes, ranked);

    if (!parsed.deferAccess) {
      await this.touchAccess(
        budgeted.instructions
          .map((block) => block.id)
          .filter((id) => id !== MEMORY_PROFILE_ID),
        now.toISOString(),
        warnings,
      );
    }

    return memoryRetrieveResultSchema.parse({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      status: "retrieved",
      instructions: budgeted.instructions,
      omissions,
      usedTokens: budgeted.instructions.reduce(
        (sum, block) => sum + estimateTokens(block.content),
        0,
      ),
      budgetTokens: parsed.budgetTokens,
      warnings,
      reasonCodes: unique(reasonCodes),
      durationMs: Date.now() - startedMs,
    });
  }

  public async commit(input: MemoryCommitInput): Promise<MemoryCommitResult> {
    const stageStartedMs = Date.now();
    const result = await commitMemory(this.store, this.idGenerator, input);
    this.log.stage({
      module: "memory",
      stage: MEMORY_STAGES.commitAndConsolidate,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: result.reasonCodes,
      outputSummary: {
        operation: "commit",
        status: result.status,
        memoryId: result.memoryId,
      },
    });
    return result;
  }

  public async consolidate(
    input: MemoryConsolidateInput,
  ): Promise<MemoryConsolidateResult> {
    const stageStartedMs = Date.now();
    const result = await consolidateMemory(this.store, input);
    this.log.stage({
      module: "memory",
      stage: MEMORY_STAGES.commitAndConsolidate,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: result.reasonCodes,
      outputSummary: {
        operation: "consolidate",
        merged: result.merged,
        superseded: result.superseded,
      },
    });
    return result;
  }

  public async recordAccess(ids: readonly string[], at: string): Promise<void> {
    if (this.store.recordAccess) {
      await this.store.recordAccess([...new Set(ids)], at);
    }
  }

  private async touchAccess(
    ids: readonly string[],
    at: string,
    warnings: string[],
  ): Promise<void> {
    if (ids.length === 0 || !this.store.recordAccess) {
      return;
    }
    try {
      await this.store.recordAccess(ids, at);
    } catch (error) {
      warnings.push(
        MEMORY_MESSAGES.accessTouchFailed(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
}

const MEMORY_PROFILE_ID = "mem-profile";

function pushRankReasons(
  reasonCodes: MemoryReasonCode[],
  ranked: { hybrid: boolean; fileBoosted: boolean },
): void {
  if (ranked.hybrid) {
    reasonCodes.push(MEMORY_REASON.hybrid);
  } else if (ranked.fileBoosted) {
    reasonCodes.push(MEMORY_REASON.fileBoosted);
  } else {
    reasonCodes.push(MEMORY_REASON.bm25Only);
  }
}

function buildLayeredInstructions(
  params: Parameters<typeof applyMemoryBudget>[0],
) {
  const selected = applyMemoryBudget(params);
  return {
    ...selected,
    layers: { l1Index: [], l2Timeline: [], l3Facts: selected.instructions },
  };
}

function appendWorkspaceProfile(params: {
  instructions: Array<{
    id: string;
    title?: string;
    content: string;
    priority: number;
    provenance: {
      memoryId: string;
      source: "memory";
      scopeKind: "user" | "workspace" | "project";
      score: number;
      privacy: "private" | "shareable";
      createdAt: string;
    };
  }>;
  candidates: readonly MemoryFact[];
  budgetTokens: number;
  maxFacts: number;
  usedTokens: number;
  now: Date;
}): void {
  if (params.instructions.length >= params.maxFacts) {
    return;
  }
  if (params.budgetTokens < MEMORY_THRESHOLDS.profileMinBudgetTokens) {
    return;
  }
  const content = buildWorkspaceProfile(params.candidates);
  if (!content) {
    return;
  }
  const tokens = estimateTokens(content);
  if (params.usedTokens + tokens > params.budgetTokens) {
    return;
  }
  params.instructions.push({
    id: MEMORY_PROFILE_ID,
    title: "Workspace memory profile",
    content,
    priority: 40,
    provenance: {
      memoryId: MEMORY_PROFILE_ID,
      source: "memory",
      scopeKind: "workspace",
      score: 0.4,
      privacy: "shareable",
      createdAt: params.now.toISOString(),
    },
  });
}

function unique(codes: readonly MemoryReasonCode[]): MemoryReasonCode[] {
  return [...new Set(codes)];
}
