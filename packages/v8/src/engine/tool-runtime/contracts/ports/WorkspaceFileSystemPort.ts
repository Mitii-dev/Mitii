export type WorkspaceEntryKind = "file" | "directory" | "symlink" | "other";

export interface WorkspaceStat {
  kind: WorkspaceEntryKind;
  sizeBytes: number;
  isSymlink: boolean;
  /** Epoch milliseconds when known; adapters may omit for synthetic FS. */
  mtimeMs?: number;
}

export interface WorkspaceDirectoryEntry {
  name: string;
  kind: WorkspaceEntryKind;
}

/** Options for workspace file reads (byte and/or line windows). */
export interface WorkspaceReadFileOptions {
  maxBytes?: number;
  /** 1-based inclusive start line. */
  startLine?: number;
  /** 1-based inclusive end line. */
  endLine?: number;
  /** Soft cap on number of lines returned. */
  maxLines?: number;
}

export type WorkspaceReadFileTruncationReason =
  | "byte_cap"
  | "line_range"
  | "max_lines"
  | "model_budget";

export interface WorkspaceReadFileResult {
  content: string;
  truncated: boolean;
  bytesRead: number;
  /** Actual first line included (1-based). */
  startLine: number;
  /** Actual last line included (1-based); 0 when content is empty. */
  endLine: number;
  totalLines?: number;
  eof: boolean;
  nextStartLine?: number;
  truncationReason?: WorkspaceReadFileTruncationReason;
}

/**
 * Workspace filesystem used by Tool Runtime.
 * Implementations MUST use lstat/realpath semantics for containment.
 * Write methods are required for Phase 8 mutation tools.
 */
export interface WorkspaceFileSystemPort {
  resolve(workspaceRoot: string, relativePath: string): string;
  lstat(absolutePath: string): Promise<WorkspaceStat>;
  realpath(absolutePath: string): Promise<string>;
  readFile(
    absolutePath: string,
    options?: WorkspaceReadFileOptions,
  ): Promise<WorkspaceReadFileResult>;
  listDirectory(absolutePath: string): Promise<WorkspaceDirectoryEntry[]>;
  /**
   * Read text files under a workspace path. The path MAY be a file or a
   * directory. File roots MUST return that single file (or [] if over
   * `maxFileBytes`); they MUST NOT throw ENOTDIR.
   */
  readTextFilesUnder?(
    absoluteDirectory: string,
    options: {
      workspaceRoot: string;
      maxFiles: number;
      maxFileBytes: number;
    },
  ): Promise<Array<{ relativePath: string; content: string }>>;

  /** Create parent directories as needed, then write UTF-8 file contents. */
  writeFile(absolutePath: string, content: string): Promise<void>;
  /** Remove a file. Missing paths are a no-op. */
  unlink(absolutePath: string): Promise<void>;
  /** Ensure a directory exists (including parents). */
  mkdirp(absolutePath: string): Promise<void>;
  /**
   * Remove a directory. When `recursive` is true, delete contents first.
   * Missing paths are a no-op when `recursive` is true.
   */
  rmdir?(
    absolutePath: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
  /** Rename/move a path. Fails if the destination already exists. */
  rename?(fromAbsolutePath: string, toAbsolutePath: string): Promise<void>;
}
