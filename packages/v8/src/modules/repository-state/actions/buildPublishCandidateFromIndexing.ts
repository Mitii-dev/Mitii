import type {
  PublishRepositoryStateInput,
} from "../contracts/input/PublishRepositoryStateInput";
import type {
  RepositoryCapabilityStatus,
  RepositoryRootState,
  RepositoryStateReason,
  RepositoryStateScanCompleteness,
} from "../contracts/output/RepositoryStateDescriptor";
import { WORKSPACE_INDEXING_PIPELINE_MESSAGES } from "../pipeline/ws-indexing-pipeline/constants";
import type {
  WorkspaceIndexingPipelineResult,
  WorkspaceIndexingRootResult,
} from "../pipeline/ws-indexing-pipeline/types";
import { REPOSITORY_STATE_SCHEMA_VERSION } from "../constants";

export type BuildPublishCandidateFromIndexingResult =
  | {
      status: "ready";
      candidate: PublishRepositoryStateInput;
    }
  | {
      status: "failed";
      code: "invalid_candidate";
      message: string;
    };

export interface PublishCandidateFromIndexingOptions {
  /**
   * Optional per-root graph revisions produced by RepoGraph builders.
   * When supplied, graph capability becomes ready for that root.
   */
  graphRevisionByRoot?: Readonly<Record<string, string>>;

  /**
   * Optional per-root map revisions produced by RepoMap builders.
   * When supplied, map capability becomes ready for that root.
   */
  mapRevisionByRoot?: Readonly<Record<string, string>>;
}

/**
 * Maps a WorkspaceIndexingPipeline result into a Repository State publish
 * candidate. Graph/map default to unavailable unless revision overlays are
 * supplied by their builders.
 */
export function buildPublishCandidateFromIndexing(
  indexing: WorkspaceIndexingPipelineResult,
  options: PublishCandidateFromIndexingOptions = {},
): BuildPublishCandidateFromIndexingResult {
  if (indexing.rootResults.length === 0) {
    return {
      status: "failed",
      code: "invalid_candidate",
      message:
        "Indexing produced no root results; cannot publish repository state.",
    };
  }

  const scanCompleteness = resolveScanCompleteness(indexing);
  const reasons = collectReasons(indexing, scanCompleteness);
  const roots = indexing.rootResults.map((root) =>
    mapRoot(root, indexing.workspaceSnapshotId, options),
  );

  return {
    status: "ready",
    candidate: {
      schemaVersion: REPOSITORY_STATE_SCHEMA_VERSION,
      workspaceId: indexing.workspace,
      snapshotId: indexing.workspaceSnapshotId,
      roots,
      scanCompleteness,
      reasons,
      generatedAt: new Date(indexing.indexedAt).toISOString(),
    },
  };
}

function resolveScanCompleteness(
  indexing: WorkspaceIndexingPipelineResult,
): RepositoryStateScanCompleteness {
  if (indexing.status === "cancelled") {
    return "cancelled";
  }

  const cleanupWarning = indexing.warnings.find(
    (warning) => warning.code === "cleanup_skipped",
  );

  if (
    cleanupWarning?.message ===
    WORKSPACE_INDEXING_PIPELINE_MESSAGES.CLEANUP_FILTERED_RUN
  ) {
    return "filtered";
  }

  if (
    cleanupWarning?.message ===
      WORKSPACE_INDEXING_PIPELINE_MESSAGES.CLEANUP_TRUNCATED_RUN ||
    indexing.fileResultsTruncated
  ) {
    return "truncated";
  }

  if (indexing.cleanupAllowed && indexing.status === "complete") {
    return "complete";
  }

  return "partial";
}

function collectReasons(
  indexing: WorkspaceIndexingPipelineResult,
  scanCompleteness: RepositoryStateScanCompleteness,
): RepositoryStateReason[] {
  const reasons: RepositoryStateReason[] = [];

  if (scanCompleteness !== "complete") {
    reasons.push({
      code:
        scanCompleteness === "filtered"
          ? "scan_filtered"
          : scanCompleteness === "truncated"
            ? "scan_truncated"
            : scanCompleteness === "cancelled"
              ? "scan_cancelled"
              : "scan_partial",
      message: `Indexing scan completeness is ${scanCompleteness}.`,
    });
  }

  for (const warning of indexing.warnings) {
    if (warning.code === "cancelled") {
      reasons.push({
        code: "scan_cancelled",
        message: warning.message,
        rootId: warning.rootId,
      });
    }
  }

  return reasons;
}

function mapRoot(
  root: WorkspaceIndexingRootResult,
  snapshotId: string,
  options: PublishCandidateFromIndexingOptions,
): RepositoryRootState {
  const textRevision = pickTextRevision(root);
  const graphRevision = options.graphRevisionByRoot?.[root.rootId];
  const mapRevision = options.mapRevisionByRoot?.[root.rootId];

  const capabilities: RepositoryCapabilityStatus[] = [
    {
      capability: "catalog",
      status: "ready",
    },
    mapIndexCapability("codeIndex", root, root.codeIndexRevision !== undefined),
    mapIndexCapability("textIndex", root, textRevision !== undefined),
    mapVectorCapability(root),
    graphRevision
      ? {
          capability: "graph",
          status: "ready",
        }
      : {
          capability: "graph",
          status: "unavailable",
          reasonCode: "capability_unavailable",
        },
    mapRevision
      ? {
          capability: "map",
          status: "ready",
        }
      : {
          capability: "map",
          status: "unavailable",
          reasonCode: "capability_unavailable",
        },
  ];

  return {
    rootId: root.rootId,
    projectCatalogRevision: snapshotId,
    ...(root.codeIndexRevision !== undefined
      ? { codeIndexRevision: String(root.codeIndexRevision) }
      : {}),
    ...(textRevision !== undefined
      ? { textIndexRevision: String(textRevision) }
      : {}),
    ...(root.embeddingProfileId
      ? { vectorProfile: root.embeddingProfileId }
      : {}),
    ...(root.embeddingStatus === "complete" ||
    root.embeddingStatus === "unchanged"
      ? textRevision !== undefined
        ? { vectorIndexRevision: String(textRevision) }
        : {}
      : {}),
    ...(graphRevision ? { graphRevision } : {}),
    ...(mapRevision ? { mapRevision } : {}),
    capabilities,
  };
}

function pickTextRevision(
  root: WorkspaceIndexingRootResult,
): number | undefined {
  return (
    root.finalTextRevision ??
    root.latestTextRevision ??
    root.initialTextRevision
  );
}

function mapIndexCapability(
  capability: "codeIndex" | "textIndex",
  root: WorkspaceIndexingRootResult,
  hasRevision: boolean,
): RepositoryCapabilityStatus {
  if (root.status === "cancelled") {
    return {
      capability,
      status: "unavailable",
      reasonCode: "scan_cancelled",
    };
  }

  if (root.status === "skipped" || !hasRevision) {
    return {
      capability,
      status: "unavailable",
      reasonCode: "capability_unavailable",
    };
  }

  if (root.status === "partial") {
    return {
      capability,
      status: "degraded",
      reasonCode: "capability_degraded",
    };
  }

  return {
    capability,
    status: "ready",
  };
}

function mapVectorCapability(
  root: WorkspaceIndexingRootResult,
): RepositoryCapabilityStatus {
  if (!root.embeddingStatus) {
    return {
      capability: "vectorIndex",
      status: "unavailable",
      reasonCode: "capability_unavailable",
    };
  }

  if (root.embeddingStatus === "cancelled") {
    return {
      capability: "vectorIndex",
      status: "unavailable",
      reasonCode: "capability_unavailable",
    };
  }

  if (root.embeddingStatus === "partial") {
    return {
      capability: "vectorIndex",
      status: "degraded",
      reasonCode: "capability_degraded",
    };
  }

  // complete | unchanged
  return {
    capability: "vectorIndex",
    status: "ready",
  };
}
