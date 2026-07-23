import type { FileSystemWritePort } from "./FileSystemWritePort";

export interface DeleteFileOptions {
  /**
   * Return successfully when the file does not exist.
   */
  ignoreIfNotExists?: boolean;
}

export interface DeleteDirectoryOptions {
  /**
   * Delete directory contents recursively.
   *
   * This must default to false.
   */
  recursive?: boolean;

  /**
   * Return successfully when the directory does not exist.
   */
  ignoreIfNotExists?: boolean;
}

export interface RenamePathOptions {
  /**
   * Allow replacement of an existing destination.
   *
   * This must default to false.
   */
  overwrite?: boolean;
}

export interface FileSystemMutationPort extends FileSystemWritePort {
  deleteFile(path: string, options?: DeleteFileOptions): Promise<void>;

  deleteDirectory(
    path: string,
    options?: DeleteDirectoryOptions,
  ): Promise<void>;

  rename(
    sourcePath: string,
    destinationPath: string,
    options?: RenamePathOptions,
  ): Promise<void>;
}
