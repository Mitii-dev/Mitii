export type {
  FileSystemEntry,
  FileSystemEntryKind,
  FileSystemReadOptions,
  FileSystemStat,
  FileSystemReadPort,
} from "./FileSystemReadPort";

export type {
  FileSystemWriteOptions,
  FileSystemWritePort,
} from "./FileSystemWritePort";

export type {
  DeleteDirectoryOptions,
  DeleteFileOptions,
  RenamePathOptions,
  FileSystemMutationPort,
} from "./FileSystemMutationPort";

import type { FileSystemMutationPort } from "./FileSystemMutationPort";

/**
 * Complete filesystem capability.
 *
 * Prefer narrower interfaces in constructors:
 * - FileSystemReadPort
 * - FileSystemWritePort
 * - FileSystemMutationPort
 */
export type FileSystemPort = FileSystemMutationPort;
