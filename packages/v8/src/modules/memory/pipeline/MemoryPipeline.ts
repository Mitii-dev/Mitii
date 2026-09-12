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
  memoryConsolidateInputSchema,
  memoryConsolidateResultSchema,
  memoryFactSchema,
  memoryRetrieveInputSchema,
  memoryRetrieveResultSchema,
} from "../contracts";
import type {
  MemoryCommitInput,
  MemoryCommitParsedInput,
  MemoryCommitResult,
  MemoryConsolidateInput,
  MemoryConsolidateParsedInput,
  MemoryConsolidateResult,
  MemoryEmbeddingPort,
  MemoryFact,
  MemoryIdGeneratorPort,
  MemoryInstructionBlock,
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
 *   → optional layered partition (mode=layered)
 *
 * Flow (commit):
 *   validate → redact → reinforce/supersede → persist via store port
 *
 * Flow (consolidate):
 *   list scope → merge whitespace-normalized duplicates → supersede older
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

    if (parsed.mode === "layered") {
      const layered = buildLayeredInstructions({
        scored: ranked.scored,
        budgetTokens: parsed.budgetTokens,
        maxFacts: parsed.maxFacts,
      });
      const omissions = [...filtered.omissions, ...irrelevant, ...layered.omissions];
      if (layered.instructions.length === 0) {
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
          layers: layered.layers,
        });
      }

      reasonCodes.push("memory_retrieved", "memory_layered");
      if (ranked.hybrid) {
        reasonCodes.push("memory_hybrid");
      } else if (ranked.fileBoosted) {
        reasonCodes.push("memory_file_boosted");
      } else {
        reasonCodes.push("memory_bm25_only");
      }
      if (layered.budgetOmitted) {
        reasonCodes.push("budget_omitted_memory");
      }

      await this.touchAccess(
        layered.instructions
          .map((block) => block.id)
          .filter((id) => !id.startsWith("mem-l") && id !== MEMORY_PROFILE_ID),
        now.toISOString(),
        warnings,
      );

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

  /**
   * Merge near-duplicate facts in a scope (whitespace-normalized content)
   * and supersede older duplicates via the store commit path.
   */
  public async consolidate(
    input: MemoryConsolidateInput,
  ): Promise<MemoryConsolidateResult> {
    const startedMs = Date.now();
    let parsed: MemoryConsolidateParsedInput;
    try {
      parsed = memoryConsolidateInputSchema.parse(input);
    } catch (error) {
      throw new MemoryError(
        "invalid_input",
        "Memory consolidate input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const warnings: string[] = [];
    let rawFacts: MemoryFact[] = [];
    try {
      if (this.store.list) {
        rawFacts = [...(await this.store.list(parsed.scope))].map((fact) =>
          memoryFactSchema.parse(fact),
        );
      } else {
        rawFacts = (
          await this.store.query({ scope: parsed.scope, query: "" })
        ).map((fact) => memoryFactSchema.parse(fact));
      }
    } catch (error) {
      throw new MemoryError(
        "store_failed",
        "Memory store list/query failed during consolidate.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const latest = rawFacts.filter((fact) => fact.isLatest !== false);
    const groups = new Map<string, MemoryFact[]>();
    for (const fact of latest) {
      const key = normalizeConsolidateContent(fact.content);
      if (!key) continue;
      const bucket = groups.get(key) ?? [];
      bucket.push(fact);
      groups.set(key, bucket);
    }

    let merged = 0;
    let superseded = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const keeper = group[0]!;
      for (const older of group.slice(1)) {
        try {
          await this.store.commit({ ...older, isLatest: false });
          superseded += 1;
          merged += 1;
        } catch (error) {
          warnings.push(
            `Failed to supersede ${older.id} (kept ${keeper.id}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    return memoryConsolidateResultSchema.parse({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      scanned: latest.length,
      merged,
      superseded,
      warnings,
      reasonCodes: unique(["memory_consolidated"]),
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

function normalizeConsolidateContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().toLowerCase();
}

function buildLayeredInstructions(params: {
  scored: ReadonlyArray<{ fact: MemoryFact; score: number }>;
  budgetTokens: number;
  maxFacts: number;
}): {
  instructions: MemoryInstructionBlock[];
  omissions: Array<{ memoryId: string; reason: "budget"; tokens?: number }>;
  layers: {
    l1Index: MemoryInstructionBlock[];
    l2Timeline: MemoryInstructionBlock[];
    l3Facts: MemoryInstructionBlock[];
  };
  budgetOmitted: boolean;
} {
  const l1Budget = Math.max(1, Math.floor(params.budgetTokens * 0.3));
  const l2Budget = Math.max(1, Math.floor(params.budgetTokens * 0.3));
  const l3Budget = Math.max(
    1,
    params.budgetTokens - l1Budget - l2Budget,
  );
  const omissions: Array<{
    memoryId: string;
    reason: "budget";
    tokens?: number;
  }> = [];
  let budgetOmitted = false;

  const l1Index: MemoryInstructionBlock[] = [];
  let l1Used = 0;
  for (const entry of params.scored) {
    if (l1Index.length >= params.maxFacts) break;
    const summary = clipIndexSummary(entry.fact);
    const tokens = estimateTokens(summary);
    if (l1Used + tokens > l1Budget) {
      omissions.push({ memoryId: entry.fact.id, reason: "budget", tokens });
      budgetOmitted = true;
      continue;
    }
    l1Index.push(
      toBlock(entry.fact, summary, entry.score, `mem-l1-${entry.fact.id}`),
    );
    l1Used += tokens;
  }

  const timelineSorted = [...params.scored].sort((a, b) => {
    const aAt = Date.parse(a.fact.lastAccessedAt ?? a.fact.createdAt);
    const bAt = Date.parse(b.fact.lastAccessedAt ?? b.fact.createdAt);
    return bAt - aAt;
  });
  const l2Timeline: MemoryInstructionBlock[] = [];
  let l2Used = 0;
  for (const entry of timelineSorted) {
    if (l2Timeline.length >= params.maxFacts) break;
    const line = clipTimelineLine(entry.fact);
    const tokens = estimateTokens(line);
    if (l2Used + tokens > l2Budget) {
      budgetOmitted = true;
      continue;
    }
    l2Timeline.push(
      toBlock(entry.fact, line, entry.score, `mem-l2-${entry.fact.id}`),
    );
    l2Used += tokens;
  }

  const l3Facts: MemoryInstructionBlock[] = [];
  let l3Used = 0;
  for (const entry of params.scored) {
    if (l3Facts.length >= params.maxFacts) break;
    const content = entry.fact.content.trim();
    const tokens = estimateTokens(content);
    if (l3Used + tokens > l3Budget) {
      omissions.push({ memoryId: entry.fact.id, reason: "budget", tokens });
      budgetOmitted = true;
      continue;
    }
    l3Facts.push(toBlock(entry.fact, content, entry.score, entry.fact.id));
    l3Used += tokens;
  }

  return {
    instructions: [...l1Index, ...l2Timeline, ...l3Facts],
    omissions,
    layers: { l1Index, l2Timeline, l3Facts },
    budgetOmitted,
  };
}

function clipIndexSummary(fact: MemoryFact): string {
  const title = fact.title?.trim() || fact.type;
  const body = fact.content.trim().replace(/\s+/g, " ");
  const clip = body.length > 120 ? `${body.slice(0, 117)}…` : body;
  return `[index] ${title}: ${clip}`;
}

function clipTimelineLine(fact: MemoryFact): string {
  const at = fact.lastAccessedAt ?? fact.createdAt;
  const title = fact.title?.trim() || fact.content.trim().slice(0, 60);
  return `[timeline ${at}] ${title}`;
}

function toBlock(
  fact: MemoryFact,
  content: string,
  score: number,
  id: string,
): MemoryInstructionBlock {
  return {
    id,
    title: fact.title ?? `Memory (${fact.scope.kind})`,
    content,
    priority: Math.round(score * 100),
    provenance: {
      memoryId: fact.id,
      source: "memory",
      scopeKind: fact.scope.kind,
      score,
      privacy: fact.privacy,
      createdAt: fact.createdAt,
    },
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
