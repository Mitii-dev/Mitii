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

/**
 * Workspace filesystem used by Tool Runtime.
 * Implementations MUST use lstat/realpath semantics for containment.
 * Write methods are required for Phase 8 mutation tools.
 */
export interface WorkspaceFileSystemPort {
  resolve(workspaceRoot: string, relativePath: string): string;
  lstat(absolutePath: string): Promise<WorkspaceStat>;
  realpath(absolutePath: string): Promise<string>;
  readFile(absolutePath: string, options?: { maxBytes?: number }): Promise<{
    content: string;
    truncated: boolean;
    bytesRead: number;
  }>;
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
