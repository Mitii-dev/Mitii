import {
  applyMemoryBudget,
  estimateTokens,
  filterMemoryCandidates,
  prepareMemoryCommit,
  scoreMemoryRelevance,
} from "../actions";
import { MEMORY_SCHEMA_VERSION } from "../constants";
import {
  MemoryError,
  memoryCommitInputSchema,
  memoryCommitResultSchema,
  memoryFactSchema,
  memoryRetrieveInputSchema,
  memoryRetrieveResultSchema,
} from "../contracts";
import type {
  MemoryCommitInput,
  MemoryCommitParsedInput,
  MemoryCommitResult,
  MemoryEmbeddingPort,
  MemoryIdGeneratorPort,
  MemoryReasonCode,
  MemoryRetrieveInput,
  MemoryRetrieveParsedInput,
  MemoryRetrieveResult,
  MemoryStorePort,
} from "../contracts";
import { buildWorkspaceProfile } from "../internal/profile";
import { MEMORY_THRESHOLDS } from "../policy";

export interface MemoryPipelineDependencies {
  store: MemoryStorePort;
  idGenerator?: MemoryIdGeneratorPort;
  embedding?: MemoryEmbeddingPort;
}

/**
 * Memory facade.
 *
 * Flow (retrieve):
 *   validate → query store → filter scope/privacy/stale/superseded
 *   → BM25 + file + optional vector fusion → retention mix → budget
 *   → optional workspace profile → access touch
 *
 * Flow (commit):
 *   validate → redact → reinforce/supersede → persist via store port
 *
 * Does not own run orchestration or general prompt construction.
 */
export class MemoryPipeline {
  private readonly store: MemoryStorePort;
  private readonly idGenerator: MemoryIdGeneratorPort;
  private readonly embedding?: MemoryEmbeddingPort;

  constructor(dependencies: MemoryPipelineDependencies) {
    if (!dependencies.store) {
      throw new MemoryError(
        "misconfigured_ports",
        "MemoryPipeline requires a store port.",
      );
    }
    this.store = dependencies.store;
    this.embedding = dependencies.embedding;
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
        "Memory retrieve input failed schema validation.",
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
        "Memory store query failed.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const facts = rawFacts.map((fact) => memoryFactSchema.parse(fact));
    if (facts.length === 0) {
      reasonCodes.push("store_empty");
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

    const filtered = filterMemoryCandidates({
      facts,
      scope: parsed.scope,
      requesterUserId: parsed.requesterUserId,
      now,
    });
    if (filtered.staleFiltered) {
      reasonCodes.push("stale_memory_filtered");
    }
    if (filtered.privacyFiltered) {
      reasonCodes.push("privacy_filtered");
    }
    if (filtered.supersededFiltered) {
      reasonCodes.push("memory_superseded");
    }

    const ranked = await scoreMemoryRelevance({
      facts: filtered.candidates,
      query: parsed.query,
      fileTargets: parsed.fileTargets,
      concepts: parsed.concepts,
      maxFacts: parsed.maxFacts,
      now,
      embedding: this.embedding,
    });
    if (ranked.embeddingWarning) {
      warnings.push(ranked.embeddingWarning);
    }

    const irrelevant = filtered.candidates
      .filter(
        (fact) => !ranked.scored.some((entry) => entry.fact.id === fact.id),
      )
      .map((fact) => ({
        memoryId: fact.id,
        reason: "irrelevant" as const,
      }));

    const budgeted = applyMemoryBudget({
      scored: ranked.scored,
      budgetTokens: parsed.budgetTokens,
      maxFacts: parsed.maxFacts,
    });

    if (budgeted.budgetOmitted) {
      reasonCodes.push("budget_omitted_memory");
    }

    appendWorkspaceProfile({
      instructions: budgeted.instructions,
      candidates: filtered.candidates,
      budgetTokens: parsed.budgetTokens,
      maxFacts: parsed.maxFacts,
      usedTokens: budgeted.usedTokens,
      now,
    });

    const omissions = [
      ...filtered.omissions,
      ...irrelevant,
      ...budgeted.omissions,
    ];

    if (budgeted.instructions.length === 0) {
      reasonCodes.push("no_relevant_memory");
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

    reasonCodes.push("memory_retrieved");
    if (ranked.hybrid) {
      reasonCodes.push("memory_hybrid");
    } else if (ranked.fileBoosted) {
      reasonCodes.push("memory_file_boosted");
    } else {
      reasonCodes.push("memory_bm25_only");
    }

    await this.touchAccess(
      budgeted.instructions
        .map((block) => block.id)
        .filter((id) => id !== MEMORY_PROFILE_ID),
      now.toISOString(),
      warnings,
    );

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
    const startedMs = Date.now();

    let parsed: MemoryCommitParsedInput;
    try {
      parsed = memoryCommitInputSchema.parse(input);
    } catch (error) {
      throw new MemoryError(
        "invalid_input",
        "Memory commit input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const now = parsed.now ? new Date(parsed.now) : new Date();
    const existing = this.store.list
      ? [...(await this.store.list(parsed.scope))].map((fact) =>
          memoryFactSchema.parse(fact),
        )
      : [];
    const prepared = prepareMemoryCommit({
      input: parsed,
      id: this.idGenerator.next("mem"),
      now,
      existing,
    });

    if (!prepared.ok) {
      const reasonCodes: MemoryReasonCode[] =
        prepared.reason === "duplicate"
          ? ["memory_duplicate", "commit_rejected"]
          : ["commit_rejected"];
      return memoryCommitResultSchema.parse({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        status: "rejected",
        warnings:
          prepared.reason === "retention"
            ? ["Commit rejected: expiry must be in the future."]
            : prepared.reason === "duplicate"
              ? ["Commit rejected: duplicate fact within the dedup window."]
              : ["Commit rejected: empty content."],
        reasonCodes,
        durationMs: Date.now() - startedMs,
      });
    }

    try {
      if (prepared.superseded) {
        await this.store.commit(prepared.superseded);
      }
      await this.store.commit(prepared.fact);
    } catch (error) {
      throw new MemoryError(
        "store_failed",
        "Memory store commit failed.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const reasonCodes: MemoryReasonCode[] = ["memory_committed"];
    const warnings: string[] = [];
    if (prepared.redacted) {
      reasonCodes.push("privacy_redacted");
      warnings.push("Secrets or <private> spans were redacted before persist.");
    }
    if (prepared.reinforced) {
      reasonCodes.push("memory_reinforced");
    }
    if (prepared.superseded) {
      reasonCodes.push("memory_superseded");
    }

    return memoryCommitResultSchema.parse({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      status: "committed",
      memoryId: prepared.fact.id,
      expiresAt: prepared.fact.expiresAt,
      warnings,
      reasonCodes: unique(reasonCodes),
      durationMs: Date.now() - startedMs,
    });
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
        `Memory access touch failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

const MEMORY_PROFILE_ID = "mem-profile";

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
  candidates: readonly import("../contracts").MemoryFact[];
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
