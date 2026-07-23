import {
  BoundedWalkEntry,
  BoundedWalkInput,
  BoundedWalkResult,
  PathNormalizer,
  BOUNDED_WALKER_CONSTANTS,
  BoundedWalker,
} from "../shared";

import { workspaceSnapshotSchema } from "./schema";

import type {
  WorkspaceEntry,
  WorkspaceRoot,
  WorkspaceRootKind,
  WorkspaceScanInput,
  WorkspaceSnapshot,
  WorkspaceSnapshotLimits,
  WorkspaceSnapshotStatus,
  WorkspaceSnapshotWarning,
} from "./types";

import { WorkspaceIgnorePolicy } from "./policies";

export class WorkspaceScanner {
  constructor(
    private readonly walker: BoundedWalker,
    private readonly ignorePolicy: WorkspaceIgnorePolicy,
    private readonly pathNormalizer: PathNormalizer = new PathNormalizer(),
  ) {}

  public async scan(input: WorkspaceScanInput): Promise<WorkspaceSnapshot> {
    const startedAt = Date.now();
    const roots = this.normalizeRoots(input.roots);
    const limits = this.resolveLimits(input);

    const walkResult = await this.walker.walk(
      this.buildWalkInput(roots, limits, input.abortSignal),
    );

    const workspaceRoots = this.buildWorkspaceRoots(roots, walkResult);

    const rootIdByProviderPath = new Map(
      workspaceRoots
        .filter(
          (
            root,
          ): root is WorkspaceRoot & {
            providerPath: string;
          } => root.providerPath !== undefined,
        )
        .map((root) => [root.providerPath, root.id]),
    );

    const entries = walkResult.entries.map((entry) =>
      this.toWorkspaceEntry(entry, rootIdByProviderPath),
    );

    this.sortEntries(entries);

    const warnings = walkResult.warnings.map(
      (warning): WorkspaceSnapshotWarning => ({
        code: warning.code,
        path: warning.path,
        message: warning.message,
      }),
    );

    const snapshot: WorkspaceSnapshot = {
      schemaVersion: 1,

      roots: workspaceRoots,
      entries,

      warnings,

      statistics: {
        files: this.countEntries(entries, "file"),

        directories: this.countEntries(entries, "directory"),

        symbolicLinks: this.countEntries(entries, "symbolic_link"),

        otherEntries: this.countEntries(entries, "other"),

        ignoredEntries: walkResult.ignoredEntries,

        warnings: warnings.length,

        durationMs: Math.max(0, Date.now() - startedAt),
      },

      limits,

      status: this.resolveStatus(walkResult),

      generatedAt: new Date().toISOString(),
    };

    return workspaceSnapshotSchema.parse(snapshot) as WorkspaceSnapshot;
  }

  private buildWalkInput(
    roots: readonly string[],
    limits: WorkspaceSnapshotLimits,
    abortSignal?: AbortSignal,
  ): BoundedWalkInput {
    return {
      roots,

      maximumDepth: limits.maximumDepth,

      maximumFiles: limits.maximumFiles,

      maximumDirectories: limits.maximumDirectories,

      timeoutMs: limits.timeoutMs,

      followSymbolicLinks: limits.followSymbolicLinks,

      shouldIgnore: (context) => this.ignorePolicy.shouldIgnore(context),

      ...(abortSignal
        ? {
            abortSignal,
          }
        : {}),
    };
  }

  private resolveLimits(input: WorkspaceScanInput): WorkspaceSnapshotLimits {
    return {
      maximumDepth:
        input.maximumDepth ?? BOUNDED_WALKER_CONSTANTS.DEFAULT_MAXIMUM_DEPTH,

      maximumFiles:
        input.maximumFiles ?? BOUNDED_WALKER_CONSTANTS.DEFAULT_MAXIMUM_FILES,

      maximumDirectories:
        input.maximumDirectories ??
        BOUNDED_WALKER_CONSTANTS.DEFAULT_MAXIMUM_DIRECTORIES,

      timeoutMs: input.timeoutMs ?? BOUNDED_WALKER_CONSTANTS.DEFAULT_TIMEOUT_MS,

      followSymbolicLinks: input.followSymbolicLinks ?? false,
    };
  }

  private buildWorkspaceRoots(
    roots: readonly string[],
    result: BoundedWalkResult,
  ): WorkspaceRoot[] {
    const usedIds = new Set<string>();

    return roots.map((providerPath): WorkspaceRoot => {
      const name = this.pathNormalizer.basename(providerPath) || "workspace";

      const id = this.createUniqueRootId(name, usedIds);

      return {
        id,
        name,
        providerPath,

        kind: this.resolveRootKind(providerPath, result),
      };
    });
  }

  private resolveRootKind(
    providerPath: string,
    result: BoundedWalkResult,
  ): WorkspaceRootKind {
    const rootUnavailable = result.warnings.some(
      (warning) =>
        warning.path === providerPath &&
        (warning.code === "root_not_found" ||
          warning.code === "root_not_directory" ||
          warning.code === "stat_failed"),
    );

    if (rootUnavailable) {
      return "unavailable";
    }

    const rootFile = result.entries.some(
      (entry) =>
        entry.root === providerPath &&
        entry.path === providerPath &&
        entry.depth === 0 &&
        entry.kind === "file",
    );

    return rootFile ? "file" : "directory";
  }

  private toWorkspaceEntry(
    entry: BoundedWalkEntry,
    rootIdByProviderPath: ReadonlyMap<string, string>,
  ): WorkspaceEntry {
    const rootId = rootIdByProviderPath.get(entry.root);

    if (!rootId) {
      throw new Error(
        `Walker returned an entry for unknown ` +
          `workspace root "${entry.root}".`,
      );
    }

    const base = {
      rootId,
      relativePath: entry.relativePath,
      providerPath: entry.path,
      depth: entry.depth,
    };

    switch (entry.kind) {
      case "file":
        return {
          ...base,
          kind: "file",

          ...(entry.size !== undefined
            ? {
                size: entry.size,
              }
            : {}),

          ...(entry.modifiedAt
            ? {
                modifiedAt: entry.modifiedAt,
              }
            : {}),
        };

      case "directory":
        return {
          ...base,
          kind: "directory",
        };

      case "symbolic_link":
        return {
          ...base,
          kind: "symbolic_link",

          ...(entry.size !== undefined
            ? {
                size: entry.size,
              }
            : {}),

          ...(entry.modifiedAt
            ? {
                modifiedAt: entry.modifiedAt,
              }
            : {}),

          ...(entry.linkTarget
            ? {
                linkTarget: entry.linkTarget,
              }
            : {}),
        };

      case "other":
      default:
        return {
          ...base,
          kind: "other",
        };
    }
  }

  private resolveStatus(result: BoundedWalkResult): WorkspaceSnapshotStatus {
    if (result.cancelled) {
      return "cancelled";
    }

    if (result.timedOut) {
      return "timed_out";
    }

    if (result.truncated || !result.complete) {
      return "partial";
    }

    return "complete";
  }

  private normalizeRoots(roots: readonly string[]): string[] {
    if (roots.length === 0) {
      throw new RangeError("WorkspaceScanner requires at least one root.");
    }

    const normalized = roots
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => this.pathNormalizer.normalizePhysical(root));

    const unique = [...new Set(normalized)].sort((left, right) =>
      left.localeCompare(right),
    );

    if (unique.length === 0) {
      throw new RangeError(
        "WorkspaceScanner requires at least one non-empty root.",
      );
    }

    return unique;
  }

  private createUniqueRootId(name: string, usedIds: Set<string>): string {
    const baseId =
      name
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "workspace";

    let candidate = baseId;
    let suffix = 2;

    while (usedIds.has(candidate)) {
      candidate = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(candidate);

    return candidate;
  }

  private countEntries(
    entries: readonly WorkspaceEntry[],
    kind: WorkspaceEntry["kind"],
  ): number {
    return entries.filter((entry) => entry.kind === kind).length;
  }

  private sortEntries(entries: WorkspaceEntry[]): void {
    entries.sort((left, right) => {
      const rootComparison = left.rootId.localeCompare(right.rootId);

      if (rootComparison !== 0) {
        return rootComparison;
      }

      return left.relativePath.localeCompare(right.relativePath);
    });
  }
}
