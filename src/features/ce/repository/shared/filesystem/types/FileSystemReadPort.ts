export type FileSystemEntryKind =
  | "file"
  | "directory"
  | "symbolic_link"
  | "other";

export interface FileSystemEntry {
  name: string;
  path: string;
  kind: FileSystemEntryKind;
}

export interface FileSystemStat {
  path: string;
  kind: FileSystemEntryKind;
  size: number;
  createdAt?: string;
  modifiedAt?: string;
  symbolicLinkTarget?: string;
}

export interface FileSystemReadOptions {
  encoding?: "utf8";
  maximumBytes?: number;
}

export interface FileSystemReadPort {
  exists(path: string): Promise<boolean>;

  stat(path: string): Promise<FileSystemStat>;

  readDirectory(path: string): Promise<readonly FileSystemEntry[]>;

  readText(path: string, options?: FileSystemReadOptions): Promise<string>;

  readSymbolicLink(path: string): Promise<string>;

  realPath(path: string): Promise<string>;
}
