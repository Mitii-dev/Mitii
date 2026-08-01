import type { FileSystemReadPort } from "./FileSystemReadPort";

export interface FileSystemWriteOptions {
  encoding?: "utf8";
  createParentDirectories?: boolean;
}

export interface FileSystemWritePort extends FileSystemReadPort {
  writeText(
    path: string,
    content: string,
    options?: FileSystemWriteOptions,
  ): Promise<void>;

  createDirectory(
    path: string,
    options?: {
      recursive?: boolean;
    },
  ): Promise<void>;
}
