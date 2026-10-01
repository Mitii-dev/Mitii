import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import type { AgentEngineMemoryPort } from "../contracts/ports/AgentEnginePorts";
import type { ModelLoopCompactionPressure } from "./compactModelLoopMessages";

export type MemoryFact = { id: string; content: string };

/**
 * Fresh Memory retrieve before auto/hard compaction reinject (P3 / MEGA_PLAN I12).
 * Falls back to previous facts when the port is absent or retrieve fails/empty.
 */
export async function refreshMemoryFactsForCompaction(params: {
  memory: AgentEngineMemoryPort | undefined;
  workspaceId: string | undefined;
  query: string | undefined;
  maxChars: number;
  previous: readonly MemoryFact[];
  pressure: ModelLoopCompactionPressure;
  now: string;
  fileTargets?: readonly string[];
  signal?: AbortSignal;
}): Promise<{
  facts: MemoryFact[];
  refreshed: boolean;
  status: "refreshed" | "kept_previous" | "skipped";
}> {
  if (
    params.pressure !== "auto" &&
    params.pressure !== "hard"
  ) {
    return {
      facts: [...params.previous],
      refreshed: false,
      status: "skipped",
    };
  }
  if (!params.memory || !params.workspaceId?.trim()) {
    return {
      facts: [...params.previous],
      refreshed: false,
      status: "skipped",
    };
  }
  const query = params.query?.trim();
  if (!query) {
    return {
      facts: [...params.previous],
      refreshed: false,
      status: "skipped",
    };
  }

  try {
    const result = await params.memory.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query,
      scope: { kind: "workspace", workspaceId: params.workspaceId },
      now: params.now,
      mode: "default",
      deferAccess: true,
      signal: params.signal,
      origin: "automation",
      ...(params.fileTargets && params.fileTargets.length > 0
        ? { fileTargets: [...params.fileTargets] }
        : {}),
    });

    const layered = result.layers;
    const blocks = layered
      ? [...layered.l1Index, ...layered.l2Timeline, ...layered.l3Facts]
      : result.instructions;

    const facts = clipMemoryFacts(
      blocks.map((block) => ({
        id: block.id,
        content: block.content,
      })),
      params.maxChars,
    );

    if (facts.length === 0) {
      return {
        facts: [...params.previous],
        refreshed: false,
        status: "kept_previous",
      };
    }

    return { facts, refreshed: true, status: "refreshed" };
  } catch {
    return {
      facts: [...params.previous],
      refreshed: false,
      status: "kept_previous",
    };
  }
}

/** Clip fact list so reinject payload stays within the compaction budget. */
export function clipMemoryFacts(
  facts: readonly MemoryFact[],
  maxChars: number,
): MemoryFact[] {
  if (maxChars <= 0) {
    return [];
  }
  const out: MemoryFact[] = [];
  let used = 0;
  for (const fact of facts) {
    const content = fact.content.replace(/\s+/g, " ").trim();
    if (!fact.id.trim() || !content) {
      continue;
    }
    const line = `- (${fact.id}) ${content}`;
    if (used + line.length + 1 > maxChars) {
      break;
    }
    out.push({ id: fact.id, content });
    used += line.length + 1;
  }
  return out;
}
