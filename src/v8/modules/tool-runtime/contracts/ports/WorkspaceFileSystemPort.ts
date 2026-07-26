export type WorkspaceEntryKind = "file" | "directory" | "symlink" | "other";

export interface WorkspaceStat {
  kind: WorkspaceEntryKind;
  sizeBytes: number;
  isSymlink: boolean;
}

export interface WorkspaceDirectoryEntry {
  name: string;
  kind: WorkspaceEntryKind;
}

/**
 * Read-only workspace filesystem used by Tool Runtime.
 * Implementations MUST use lstat/realpath semantics for containment.
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
  readTextFilesUnder?(
    absoluteDirectory: string,
    options: {
      workspaceRoot: string;
      maxFiles: number;
      maxFileBytes: number;
    },
  ): Promise<Array<{ relativePath: string; content: string }>>;
}
