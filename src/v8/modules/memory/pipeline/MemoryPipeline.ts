import {
  applyMemoryBudget,
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
  MemoryCommitResult,
  MemoryIdGeneratorPort,
  MemoryReasonCode,
  MemoryRetrieveInput,
  MemoryRetrieveResult,
  MemoryStorePort,
} from "../contracts";

export interface MemoryPipelineDependencies {
  store: MemoryStorePort;
  idGenerator?: MemoryIdGeneratorPort;
}

/**
 * Memory facade.
 *
 * Flow (retrieve):
 *   validate → query store → filter scope/privacy/stale
 *   → score relevance → apply budget → instruction blocks
 *
 * Flow (commit):
 *   validate → retention/privacy policy → persist via store port
 *
 * Does not own run orchestration or general prompt construction.
 */
export class MemoryPipeline {
  private readonly store: MemoryStorePort;
  private readonly idGenerator: MemoryIdGeneratorPort;

  constructor(dependencies: MemoryPipelineDependencies) {
    if (!dependencies.store) {
      throw new MemoryError(
        "misconfigured_ports",
        "MemoryPipeline requires a store port.",
      );
    }
    this.store = dependencies.store;
    this.idGenerator = dependencies.idGenerator ?? {
      next: (prefix: string) =>
        `${prefix}_${Math.random().toString(36).slice(2, 10)}`,
    };
  }

  public async retrieve(
    input: MemoryRetrieveInput,
  ): Promise<MemoryRetrieveResult> {
    const startedMs = Date.now();

    let parsed: MemoryRetrieveInput;
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

    const scored = scoreMemoryRelevance({
      facts: filtered.candidates,
      query: parsed.query,
    });

    const irrelevant = filtered.candidates
      .filter((fact) => !scored.some((entry) => entry.fact.id === fact.id))
      .map((fact) => ({
        memoryId: fact.id,
        reason: "irrelevant" as const,
      }));

    const budgeted = applyMemoryBudget({
      scored,
      budgetTokens: parsed.budgetTokens,
      maxFacts: parsed.maxFacts,
    });

    if (budgeted.budgetOmitted) {
      reasonCodes.push("budget_omitted_memory");
    }

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
    return memoryRetrieveResultSchema.parse({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      status: "retrieved",
      instructions: budgeted.instructions,
      omissions,
      usedTokens: budgeted.usedTokens,
      budgetTokens: parsed.budgetTokens,
      warnings,
      reasonCodes: unique(reasonCodes),
      durationMs: Date.now() - startedMs,
    });
  }

  public async commit(input: MemoryCommitInput): Promise<MemoryCommitResult> {
    const startedMs = Date.now();

    let parsed: MemoryCommitInput;
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
    const prepared = prepareMemoryCommit({
      input: parsed,
      id: this.idGenerator.next("mem"),
      now,
    });

    if (!prepared.ok) {
      return memoryCommitResultSchema.parse({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        status: "rejected",
        warnings:
          prepared.reason === "retention"
            ? ["Commit rejected: expiry must be in the future."]
            : ["Commit rejected: empty content."],
        reasonCodes: ["commit_rejected"],
        durationMs: Date.now() - startedMs,
      });
    }

    try {
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

    return memoryCommitResultSchema.parse({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      status: "committed",
      memoryId: prepared.fact.id,
      expiresAt: prepared.fact.expiresAt,
      warnings: [],
      reasonCodes: ["memory_committed"],
      durationMs: Date.now() - startedMs,
    });
  }
}

function unique(codes: readonly MemoryReasonCode[]): MemoryReasonCode[] {
  return [...new Set(codes)];
}
