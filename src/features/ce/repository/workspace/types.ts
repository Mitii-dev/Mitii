import type {
  BoundedWalkIgnoreContext,
  BoundedWalkWarningCode,
} from "../shared";

/**
 * WORKSPACE IGNORE POLICY
 */

export type WorkspaceIgnoreReason =
  | "default_directory"
  | "configured_directory"
  | "configured_path"
  | "configured_file"
  | "configured_extension"
  | "custom_rule"
  | "not_ignored";

export interface WorkspaceIgnoreDecision {
  ignored: boolean;
  reason: WorkspaceIgnoreReason;
  matchedRule?: string;
}

export interface WorkspaceIgnorePolicyOptions {
  additionalDirectoryNames?: readonly string[];

  allowedDirectoryNames?: readonly string[];

  ignoredPaths?: readonly string[];
  ignoredFileNames?: readonly string[];
  ignoredExtensions?: readonly string[];

  customRule?: (context: BoundedWalkIgnoreContext) => boolean;
}

/**
 * WORKSPACE SCANNING
 */

export interface WorkspaceScanInput {
  roots: readonly string[];

  maximumDepth?: number;
  maximumFiles?: number;
  maximumDirectories?: number;
  timeoutMs?: number;

  followSymbolicLinks?: boolean;
  abortSignal?: AbortSignal;
}

export type WorkspaceRootKind = "directory" | "file" | "unavailable";

export interface WorkspaceRoot {
  /**
   * Stable identifier inside this snapshot.
   */
  id: string;

  /**
   * Human-readable root name.
   */
  name: string;

  /**
   * Path understood by FileSystemPort.
   *
   * This may be removed when serializing a snapshot
   * for external consumers or an LLM.
   */
  providerPath?: string;

  kind: WorkspaceRootKind;
}

/**
 * WORKSPACE ENTRIES
 */

export type WorkspaceEntryKind =
  | "file"
  | "directory"
  | "symbolic_link"
  | "other";

export interface WorkspaceEntryBase {
  kind: WorkspaceEntryKind;

  /**
   * References WorkspaceRoot.id.
   */
  rootId: string;

  /**
   * Canonical workspace-relative identifier.
   *
   * Examples:
   * - src/index.ts
   * - packages/core/package.json
   */
  relativePath: string;

  /**
   * Path understood by FileSystemPort.
   *
   * Examples:
   * - local absolute path
   * - VS Code provider path
   * - in-memory adapter path
   */
  providerPath?: string;

  /**
   * Root is depth 0; children begin at depth 1.
   */
  depth: number;
}

export interface WorkspaceFileEntry extends WorkspaceEntryBase {
  kind: "file";

  size?: number;
  modifiedAt?: string;

  /**
   * Added later by indexing/change detection.
   * WorkspaceScanner does not calculate it.
   */
  contentHash?: string;
}

export interface WorkspaceDirectoryEntry extends WorkspaceEntryBase {
  kind: "directory";
}

export interface WorkspaceSymbolicLinkEntry extends WorkspaceEntryBase {
  kind: "symbolic_link";

  size?: number;
  modifiedAt?: string;

  /**
   * Link value as stored by the filesystem provider.
   * It may be relative.
   */
  linkTarget?: string;
}

export interface WorkspaceOtherEntry extends WorkspaceEntryBase {
  kind: "other";
}

export type WorkspaceEntry =
  | WorkspaceFileEntry
  | WorkspaceDirectoryEntry
  | WorkspaceSymbolicLinkEntry
  | WorkspaceOtherEntry;

/**
 * WORKSPACE SNAPSHOT
 */

export type WorkspaceSnapshotStatus =
  | "complete"
  | "partial"
  | "cancelled"
  | "timed_out";

export interface WorkspaceSnapshotLimits {
  maximumDepth: number;
  maximumFiles: number;
  maximumDirectories: number;
  timeoutMs: number;
  followSymbolicLinks: boolean;
}

export interface WorkspaceSnapshotWarning {
  code: BoundedWalkWarningCode;

  /**
   * Provider path where the warning occurred.
   */
  path: string;

  message: string;
}

export interface WorkspaceSnapshotStatistics {
  files: number;
  directories: number;
  symbolicLinks: number;
  otherEntries: number;

  ignoredEntries: number;
  warnings: number;

  durationMs: number;
}

export interface WorkspaceSnapshot {
  schemaVersion: 1;

  roots: WorkspaceRoot[];
  entries: WorkspaceEntry[];

  warnings: WorkspaceSnapshotWarning[];
  statistics: WorkspaceSnapshotStatistics;

  limits: WorkspaceSnapshotLimits;
  status: WorkspaceSnapshotStatus;

  generatedAt: string;
}
