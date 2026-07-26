import type {
  PublishRepositoryStateInput,
} from "../../contracts/input/PublishRepositoryStateInput";
import type {
  RepositoryRootState,
  RepositoryStateDescriptor,
  RepositoryStateReason,
  RepositoryStateReadiness,
} from "../../contracts/output/RepositoryStateDescriptor";
import { repositoryStateReadinessSchema } from "../../contracts/output/RepositoryStateDescriptor";
import { ContentHasher } from "../shared/content-hasher/ContentHasher";

type ScanCompleteness = PublishRepositoryStateInput["scanCompleteness"];

const SCAN_REASON_BY_COMPLETENESS: Partial<
  Record<
    ScanCompleteness,
    { code: RepositoryStateReason["code"]; message: string }
  >
> = {
  partial: {
    code: "scan_partial",
    message: "Snapshot scan was partial; unseen facts must be retained.",
  },
  filtered: {
    code: "scan_filtered",
    message: "Snapshot scan was filtered; cleanup of unseen files is blocked.",
  },
  truncated: {
    code: "scan_truncated",
    message: "Snapshot scan was truncated; cleanup of unseen files is blocked.",
  },
  cancelled: {
    code: "scan_cancelled",
    message: "Snapshot scan was cancelled before completion.",
  },
};

const hasher = new ContentHasher();

function compareRootIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalRootManifest(root: RepositoryRootState): string {
  const capabilities = [...root.capabilities]
    .map((entry) =>
      [
        entry.capability,
        entry.status,
        entry.reasonCode ?? "",
      ].join(":"),
    )
    .sort();

  return hasher.hashValues([
    root.rootId,
    root.projectCatalogRevision,
    root.codeIndexRevision ?? "",
    root.textIndexRevision ?? "",
    root.vectorProfile ?? "",
    root.vectorIndexRevision ?? "",
    root.graphRevision ?? "",
    root.mapRevision ?? "",
    ...capabilities,
  ]);
}

/**
 * Derives a deterministic stateToken from the immutable manifest fields.
 */
export function deriveStateToken(input: {
  workspaceId: string;
  snapshotId: string;
  roots: readonly RepositoryRootState[];
  scanCompleteness: ScanCompleteness;
  schemaVersion: number;
}): string {
  const rootDigests = [...input.roots]
    .sort((a, b) => compareRootIds(a.rootId, b.rootId))
    .map(canonicalRootManifest);

  return hasher.hashValues([
    String(input.schemaVersion),
    input.workspaceId,
    input.snapshotId,
    input.scanCompleteness,
    ...rootDigests,
  ]);
}

export function resolveCleanupAllowed(
  scanCompleteness: ScanCompleteness,
): boolean {
  return scanCompleteness === "complete";
}

export function deriveReadiness(input: {
  scanCompleteness: ScanCompleteness;
  roots: readonly RepositoryRootState[];
}): {
  readiness: RepositoryStateReadiness;
  reasons: RepositoryStateReason[];
} {
  const reasons: RepositoryStateReason[] = [];
  const scanReason = SCAN_REASON_BY_COMPLETENESS[input.scanCompleteness];
  if (scanReason) {
    reasons.push(scanReason);
  }

  let hasReadyCapability = false;
  let hasDegradedCapability = false;
  let allUnavailable = true;

  for (const root of input.roots) {
    for (const capability of root.capabilities) {
      if (capability.status === "ready") {
        hasReadyCapability = true;
        allUnavailable = false;
      } else if (capability.status === "degraded") {
        hasDegradedCapability = true;
        allUnavailable = false;
        reasons.push({
          code: "capability_degraded",
          message: `Capability ${capability.capability} is degraded.`,
          rootId: root.rootId,
        });
      } else {
        reasons.push({
          code: "capability_unavailable",
          message: `Capability ${capability.capability} is unavailable.`,
          rootId: root.rootId,
        });
      }
    }
  }

  if (input.scanCompleteness === "cancelled" && !hasReadyCapability) {
    return {
      readiness: repositoryStateReadinessSchema.parse("unavailable"),
      reasons,
    };
  }

  if (allUnavailable) {
    return {
      readiness: repositoryStateReadinessSchema.parse("unavailable"),
      reasons,
    };
  }

  if (
    input.scanCompleteness !== "complete" ||
    hasDegradedCapability ||
    !hasReadyCapability
  ) {
    return {
      readiness: repositoryStateReadinessSchema.parse("degraded"),
      reasons,
    };
  }

  return {
    readiness: repositoryStateReadinessSchema.parse("ready"),
    reasons,
  };
}

export function buildDescriptor(input: {
  candidate: PublishRepositoryStateInput;
  generatedAt: string;
}): RepositoryStateDescriptor {
  const { readiness, reasons: derivedReasons } = deriveReadiness({
    scanCompleteness: input.candidate.scanCompleteness,
    roots: input.candidate.roots,
  });

  const reasons = dedupeReasons([
    ...input.candidate.reasons,
    ...derivedReasons,
  ]);

  const stateToken = deriveStateToken({
    workspaceId: input.candidate.workspaceId,
    snapshotId: input.candidate.snapshotId,
    roots: input.candidate.roots,
    scanCompleteness: input.candidate.scanCompleteness,
    schemaVersion: input.candidate.schemaVersion,
  });

  return {
    schemaVersion: input.candidate.schemaVersion,
    workspaceId: input.candidate.workspaceId,
    stateToken,
    snapshotId: input.candidate.snapshotId,
    roots: input.candidate.roots,
    readiness,
    reasons,
    generatedAt: input.generatedAt,
    scanCompleteness: input.candidate.scanCompleteness,
    cleanupAllowed: resolveCleanupAllowed(input.candidate.scanCompleteness),
  };
}

function dedupeReasons(
  reasons: readonly RepositoryStateReason[],
): RepositoryStateReason[] {
  const seen = new Set<string>();
  const result: RepositoryStateReason[] = [];

  for (const reason of reasons) {
    const key = `${reason.code}:${reason.rootId ?? ""}:${reason.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(reason);
  }

  return result;
}
