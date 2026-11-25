import {
  MEMORY_MESSAGES,
  MEMORY_REASON,
  MEMORY_SCHEMA_VERSION,
} from "../constants";
import {
  MemoryError,
  memoryCommitInputSchema,
  memoryCommitResultSchema,
  memoryConsolidateInputSchema,
  memoryConsolidateResultSchema,
  memoryFactSchema,
  type MemoryCommitInput,
  type MemoryCommitResult,
  type MemoryConsolidateInput,
  type MemoryConsolidateResult,
  type MemoryFact,
  type MemoryIdGeneratorPort,
  type MemoryReasonCode,
  type MemoryStorePort,
} from "../contracts";
import { prepareMemoryCommit } from "./4-prepare-commit";

export async function commitMemory(
  store: MemoryStorePort,
  ids: MemoryIdGeneratorPort,
  input: MemoryCommitInput,
): Promise<MemoryCommitResult> {
  const started = Date.now();
  const parsed = memoryCommitInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new MemoryError("invalid_input", MEMORY_MESSAGES.commitInputInvalid);
  }
  const now = parsed.data.now ? new Date(parsed.data.now) : new Date();
  const id = ids.next("mem");
  const decide = (existing: readonly MemoryFact[]) => {
    const prepared = prepareMemoryCommit({
      input: parsed.data,
      id,
      now,
      existing: existing.map((fact) => memoryFactSchema.parse(fact)),
    });
    return {
      facts: prepared.ok
        ? [
            ...(prepared.superseded ? [prepared.superseded] : []),
            prepared.fact,
          ]
        : [],
      result: prepared,
    };
  };
  let prepared: ReturnType<typeof prepareMemoryCommit>;
  try {
    if (store.transact) {
      prepared = await store.transact(parsed.data.scope, decide);
    } else {
      const decision = decide(
        store.list ? await store.list(parsed.data.scope) : [],
      );
      if (
        decision.result.ok &&
        (decision.result.superseded || decision.result.reinforced)
      ) {
        throw new MemoryError(
          "misconfigured_ports",
          MEMORY_MESSAGES.correctionNeedsAtomic,
        );
      }
      for (const fact of decision.facts) {
        await store.commit(fact);
      }
      prepared = decision.result;
    }
  } catch (error) {
    throw new MemoryError("store_failed", MEMORY_MESSAGES.storeCommitFailed, {
      cause: error instanceof Error ? error.message : "Unknown storage failure",
    });
  }
  const reasonCodes: MemoryReasonCode[] = [];
  if (!prepared.ok) {
    if (prepared.reason === "duplicate") {
      reasonCodes.push(MEMORY_REASON.duplicate);
    }
    reasonCodes.push(MEMORY_REASON.commitRejected);
    return memoryCommitResultSchema.parse({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      status: "rejected",
      warnings: [MEMORY_MESSAGES.commitRejected(prepared.reason)],
      reasonCodes,
      durationMs: Date.now() - started,
    });
  }
  reasonCodes.push(MEMORY_REASON.committed);
  if (prepared.reinforced) {
    reasonCodes.push(MEMORY_REASON.reinforced);
  }
  if (prepared.superseded) {
    reasonCodes.push(MEMORY_REASON.superseded);
  }
  if (prepared.redacted) {
    reasonCodes.push(MEMORY_REASON.privacyRedacted);
  }
  return memoryCommitResultSchema.parse({
    schemaVersion: MEMORY_SCHEMA_VERSION,
    status: "committed",
    memoryId: prepared.fact.id,
    expiresAt: prepared.fact.expiresAt,
    warnings: prepared.redacted
      ? [MEMORY_MESSAGES.privacyRedacted]
      : [],
    reasonCodes,
    durationMs: Date.now() - started,
  });
}

export async function consolidateMemory(
  store: MemoryStorePort,
  input: MemoryConsolidateInput,
): Promise<MemoryConsolidateResult> {
  const started = Date.now();
  const parsed = memoryConsolidateInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new MemoryError(
      "invalid_input",
      MEMORY_MESSAGES.consolidateInputInvalid,
    );
  }
  if (!store.transact) {
    throw new MemoryError(
      "misconfigured_ports",
      MEMORY_MESSAGES.consolidateNeedsAtomic,
    );
  }
  const result = await store.transact(parsed.data.scope, (rows) => {
    const now = Date.parse(parsed.data.now ?? new Date().toISOString());
    const latest = rows
      .map((row) => memoryFactSchema.parse(row))
      .filter(
        (row) =>
          row.isLatest && (!row.expiresAt || Date.parse(row.expiresAt) > now),
      );
    const groups = new Map<string, MemoryFact[]>();
    for (const row of latest) {
      // Scope, privacy, applicability and claim identity cannot be merged away.
      const key = JSON.stringify([
        row.scope,
        row.privacy,
        row.claimKey,
        row.applicability,
        row.content.replace(/\s+/g, " ").trim(),
      ]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const facts: MemoryFact[] = [];
    for (const group of groups.values()) {
      if (group.length < 2) {
        continue;
      }
      group.sort(
        (a, b) =>
          Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
          b.createdAt.localeCompare(a.createdAt),
      );
      const [keeper, ...older] = group;
      facts.push({
        ...keeper,
        sourceIds: [...new Set(group.flatMap((row) => row.sourceIds))],
        supersedes: [
          ...new Set([...keeper.supersedes, ...older.map((row) => row.id)]),
        ],
      });
      facts.push(...older.map((row) => ({ ...row, isLatest: false })));
    }
    return {
      facts,
      result: {
        scanned: latest.length,
        merged: facts.filter((row) => !row.isLatest).length,
      },
    };
  });
  return memoryConsolidateResultSchema.parse({
    schemaVersion: MEMORY_SCHEMA_VERSION,
    ...result,
    superseded: result.merged,
    warnings: [],
    reasonCodes: [MEMORY_REASON.consolidated],
    durationMs: Date.now() - started,
  });
}
