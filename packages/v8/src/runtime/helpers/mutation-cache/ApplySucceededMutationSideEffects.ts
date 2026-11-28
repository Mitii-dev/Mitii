import type { AgentReasonCode } from "../../../engine/v8-engine/contracts";
import {
  dropEstablishedFactsForPaths,
  type EstablishedFact,
} from "../established-facts";

/**
 * Manifest / install surfaces commonly rewritten by package-manager
 * `run_command` (npm/pnpm/yarn/bun). Used to drop path-tied established
 * facts after a shell mutation; content cache is full-wiped separately
 * because `run_readonly_command` entries store empty path metadata.
 */
export const SHELL_MUTATION_MANIFEST_PATHS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "node_modules",
] as const;

export interface MutationContentCachePort {
  invalidateContent(changedFiles?: readonly string[]): void;
}

export interface MutationReadLedgerPort {
  invalidatePaths(paths: readonly string[]): void;
  clear(): void;
}

/**
 * After a successful workspace mutation, drop stale read-only tool
 * results so the next verify (build/test/read) re-executes against the
 * live tree.
 */
export function applySucceededMutationSideEffects(params: {
  toolName: string;
  output: { checkpointId?: string; changedFiles?: string[] } | undefined;
  mutationCheckpointIds: string[];
  changedFiles: string[];
  toolCache: MutationContentCachePort;
  readLedger?: MutationReadLedgerPort;
  establishedFacts?: EstablishedFact[];
  reasonCodes: AgentReasonCode[];
}): void {
  if (params.output?.checkpointId) {
    params.mutationCheckpointIds.push(params.output.checkpointId);
    for (const changed of params.output.changedFiles ?? []) {
      if (!params.changedFiles.includes(changed)) {
        params.changedFiles.push(changed);
      }
    }
    params.reasonCodes.push("mutation_applied");
    params.toolCache.invalidateContent(params.output.changedFiles ?? []);
    params.readLedger?.invalidatePaths(params.output.changedFiles ?? []);
    dropEstablishedFactsForPaths(
      params.establishedFacts ?? [],
      params.output.changedFiles ?? [],
    );
    return;
  }

  if (params.toolName !== "run_command") {
    return;
  }

  params.reasonCodes.push("mutation_applied");
  params.reasonCodes.push("shell_mutation_cache_invalidated");
  params.toolCache.invalidateContent();
  params.readLedger?.clear();
  dropEstablishedFactsForPaths(params.establishedFacts ?? [], [
    ...SHELL_MUTATION_MANIFEST_PATHS,
  ]);
}
