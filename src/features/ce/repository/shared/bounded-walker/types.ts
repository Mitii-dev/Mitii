/**
 * BOUNDED FILESYSTEM WALKING
 */

import { FileSystemEntryKind } from "../filesystem";
import { BOUNDED_WALKER_CONSTANTS } from "./constants";

export interface BoundedWalkEntry {
  /**
   * Original root responsible for this entry.
   */
  root: string;

  /**
   * Provider/native path used by FileSystemReadPort.
   */
  path: string;

  /**
   * Canonical workspace-relative path.
   */
  relativePath: string;

  /**
   * Root is depth 0; its children are depth 1.
   */
  depth: number;

  kind: FileSystemEntryKind;
  size?: number;
  modifiedAt?: string;
  linkTarget?: string;
}

export interface BoundedWalkWarning {
  code: BoundedWalkWarningCode;
  path: string;
  message: string;
}

export interface BoundedWalkIgnoreContext {
  root: string;
  path: string;
  relativePath: string;
  depth: number;
  kind: FileSystemEntryKind;
}

export interface BoundedWalkInput {
  roots: readonly string[];

  maximumDepth?: number;
  maximumFiles?: number;
  maximumDirectories?: number;

  /**
   * Defaults to false.
   */
  followSymbolicLinks?: boolean;

  /**
   * Called before an entry is added or traversed.
   */
  shouldIgnore?: (
    context: BoundedWalkIgnoreContext,
  ) => boolean | Promise<boolean>;

  abortSignal?: AbortSignal;
}

export interface BoundedWalkResult {
  entries: BoundedWalkEntry[];
  warnings: BoundedWalkWarning[];

  filesVisited: number;
  directoriesVisited: number;
  symbolicLinksVisited: number;

  ignoredEntries: number;

  complete: boolean;
  truncated: boolean;
  cancelled: boolean;
}

export interface DirectoryQueueItem {
  root: string;
  rootRealPath: string;
  path: string;
  relativePath: string;
  depth: number;
}

export interface WalkState {
  entries: BoundedWalkEntry[];
  warnings: BoundedWalkWarning[];

  filesVisited: number;
  directoriesVisited: number;
  symbolicLinksVisited: number;
  ignoredEntries: number;

  truncated: boolean;
  cancelled: boolean;
  stopped: boolean;

  reportedMaximumFiles: boolean;
  reportedMaximumDirectories: boolean;

  visitedRealDirectories: Set<string>;
}

export type BoundedWalkWarningCode =
  (typeof BOUNDED_WALKER_CONSTANTS.BOUNDED_WALK_WARNING_CODES)[number];

export interface BoundedWalkInput {
  roots: readonly string[];

  maximumDepth?: number;
  maximumFiles?: number;
  maximumDirectories?: number;

  /**
   * Maximum total traversal time.
   */
  timeoutMs?: number;

  followSymbolicLinks?: boolean;

  shouldIgnore?: (
    context: BoundedWalkIgnoreContext,
  ) => boolean | Promise<boolean>;

  abortSignal?: AbortSignal;
}

export interface BoundedWalkResult {
  entries: BoundedWalkEntry[];
  warnings: BoundedWalkWarning[];

  filesVisited: number;
  directoriesVisited: number;
  symbolicLinksVisited: number;
  ignoredEntries: number;

  complete: boolean;
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
}

export interface NormalizedWalkOptions {
  maximumDepth: number;
  maximumFiles: number;
  maximumDirectories: number;

  timeoutMs: number;
  deadline: number;

  followSymbolicLinks: boolean;

  shouldIgnore: BoundedWalkInput["shouldIgnore"] | undefined;

  abortSignal: AbortSignal | undefined;
}

export interface WalkState {
  entries: BoundedWalkEntry[];
  warnings: BoundedWalkWarning[];

  filesVisited: number;
  directoriesVisited: number;
  symbolicLinksVisited: number;
  ignoredEntries: number;

  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
  stopped: boolean;

  reportedMaximumFiles: boolean;
  reportedMaximumDirectories: boolean;
  reportedTimeout: boolean;

  visitedRealDirectories: Set<string>;
}
