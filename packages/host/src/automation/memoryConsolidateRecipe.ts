/**
 * Schedule prompt / recipe for periodic MemoryPipeline.consolidate.
 * Pair with docs/automation/cron/memory-consolidate.cron.md.
 *
 * Hosts should wrap consolidate with
 * `createWorkspaceMemoryLeaseStore(root).withLease({ resource: 'memory:consolidate', ... })`
 * or `runMemoryConsolidateWithLease`.
 */

export const MEMORY_CONSOLIDATE_SCHEDULE_NAME = "memory-consolidate";

export const MEMORY_CONSOLIDATE_SCHEDULE_PROMPT = `Consolidate workspace memory duplicates.

Use MemoryPipeline.consolidate for the current workspace scope:
- Acquire memory:consolidate lease first (host FileWorkspaceMemoryLeaseStore)
- Normalize whitespace when comparing content
- Supersede older near-duplicates; keep the newest fact
- Reply with scanned / merged / superseded counts only
- Do not edit repository files`;

export function buildMemoryConsolidateScheduleInput(params: {
  workspaceRoot: string;
  cron?: string;
  timezone?: string;
}): {
  name: string;
  cron: string;
  timezone: string;
  mode: "ask";
  autonomyPreset: "readonly";
  prompt: string;
  workspaceRoot: string;
  enabled: boolean;
} {
  return {
    name: MEMORY_CONSOLIDATE_SCHEDULE_NAME,
    cron: params.cron ?? "0 3 * * 0",
    timezone: params.timezone ?? "UTC",
    mode: "ask",
    autonomyPreset: "readonly",
    prompt: MEMORY_CONSOLIDATE_SCHEDULE_PROMPT,
    workspaceRoot: params.workspaceRoot,
    enabled: false,
  };
}

/**
 * Run consolidate under a durable lease. Prefer this from cron / CLI hosts.
 */
export async function runMemoryConsolidateWithLease<T>(params: {
  workspaceRoot: string;
  holderId: string;
  consolidate: () => Promise<T>;
  ttlMs?: number;
}): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const { createWorkspaceMemoryLeaseStore } = await import(
    "../ports/memoryLeases.js"
  );
  const store = createWorkspaceMemoryLeaseStore(params.workspaceRoot);
  return store.withLease({
    resource: "memory:consolidate",
    holderId: params.holderId,
    ttlMs: params.ttlMs ?? 10 * 60 * 1000,
    fn: params.consolidate,
  });
}
