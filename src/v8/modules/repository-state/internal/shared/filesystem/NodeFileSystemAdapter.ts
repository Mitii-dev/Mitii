import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Dirent, Stats } from "node:fs";

import { FileSizeLimitExceededError } from "./types";

import type {
  DeleteDirectoryOptions,
  DeleteFileOptions,
  FileSystemEntry,
  FileSystemEntryKind,
  FileSystemPort,
  FileSystemReadOptions,
  FileSystemStat,
  FileSystemWriteOptions,
  RenamePathOptions,
} from "./types";

export class NodeFileSystemAdapter implements FileSystemPort {
  public async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);

      return true;
    } catch (error) {
      if (this.isMissingPathError(error)) {
        return false;
      }

      throw error;
    }
  }

  public async stat(targetPath: string): Promise<FileSystemStat> {
    const stats = await fs.lstat(targetPath);
    const kind = this.determineKind(stats);

    const result: FileSystemStat = {
      path: targetPath,
      kind,
      size: stats.size,
    };

    const createdAt = this.toOptionalIsoDate(
      stats.birthtime,
      stats.birthtimeMs,
    );

    const modifiedAt = this.toOptionalIsoDate(stats.mtime, stats.mtimeMs);

    if (createdAt) {
      result.createdAt = createdAt;
    }

    if (modifiedAt) {
      result.modifiedAt = modifiedAt;
    }

    if (kind === "symbolic_link") {
      result.symbolicLinkTarget = await this.readSymbolicLink(targetPath);
    }

    return result;
  }

  public async readDirectory(
    targetPath: string,
  ): Promise<readonly FileSystemEntry[]> {
    const entries = await fs.readdir(targetPath, {
      withFileTypes: true,
    });

    return entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(
        (entry: Dirent): FileSystemEntry => ({
          name: entry.name,
          path: path.join(targetPath, entry.name),
          kind: this.determineDirentKind(entry),
        }),
      );
  }

  public async readText(
    targetPath: string,
    options?: FileSystemReadOptions,
  ): Promise<string> {
    const encoding = options?.encoding ?? "utf8";

    const maximumBytes = options?.maximumBytes;

    if (maximumBytes !== undefined) {
      this.validateMaximumBytes(maximumBytes);

      return this.readTextWithLimit(targetPath, maximumBytes, encoding);
    }

    return fs.readFile(targetPath, {
      encoding,
    });
  }

  public async writeText(
    targetPath: string,
    content: string,
    options?: FileSystemWriteOptions,
  ): Promise<void> {
    if (options?.createParentDirectories) {
      await this.createDirectory(path.dirname(targetPath), {
        recursive: true,
      });
    }

    await fs.writeFile(targetPath, content, {
      encoding: options?.encoding ?? "utf8",
    });
  }

  public async createDirectory(
    targetPath: string,
    options?: {
      recursive?: boolean;
    },
  ): Promise<void> {
    await fs.mkdir(targetPath, {
      recursive: options?.recursive ?? false,
    });
  }

  public async readSymbolicLink(targetPath: string): Promise<string> {
    return fs.readlink(targetPath);
  }

  public async realPath(targetPath: string): Promise<string> {
    return fs.realpath(targetPath);
  }

  public async deleteFile(
    targetPath: string,
    options?: DeleteFileOptions,
  ): Promise<void> {
    try {
      const stats = await fs.lstat(targetPath);

      if (stats.isDirectory()) {
        throw this.createFileSystemError(
          "EISDIR",
          `Cannot delete directory using deleteFile(): ` + `"${targetPath}".`,
        );
      }

      await fs.unlink(targetPath);
    } catch (error) {
      if (options?.ignoreIfNotExists && this.isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }

  public async deleteDirectory(
    targetPath: string,
    options?: DeleteDirectoryOptions,
  ): Promise<void> {
    try {
      const stats = await fs.lstat(targetPath);

      if (!stats.isDirectory()) {
        throw this.createFileSystemError(
          "ENOTDIR",
          `Cannot delete non-directory using ` +
            `deleteDirectory(): "${targetPath}".`,
        );
      }

      if (options?.recursive) {
        await fs.rm(targetPath, {
          recursive: true,
          force: false,
        });

        return;
      }

      await fs.rmdir(targetPath);
    } catch (error) {
      if (options?.ignoreIfNotExists && this.isMissingPathError(error)) {
        return;
      }

      throw error;
    }
  }

  public async rename(
    sourcePath: string,
    destinationPath: string,
    options?: RenamePathOptions,
  ): Promise<void> {
    if (!options?.overwrite && (await this.exists(destinationPath))) {
      throw this.createFileSystemError(
        "EEXIST",
        `Destination already exists: ` + `"${destinationPath}".`,
      );
    }

    if (options?.overwrite && (await this.exists(destinationPath))) {
      const destinationStat = await this.stat(destinationPath);

      if (destinationStat.kind === "directory") {
        await this.deleteDirectory(destinationPath, {
          recursive: true,
        });
      } else {
        await this.deleteFile(destinationPath);
      }
    }

    await fs.rename(sourcePath, destinationPath);
  }

  private async readTextWithLimit(
    targetPath: string,
    maximumBytes: number,
    encoding: "utf8",
  ): Promise<string> {
    const fileHandle = await fs.open(targetPath, "r");

    try {
      const readLength = maximumBytes + 1;
      const buffer = Buffer.alloc(readLength);

      const { bytesRead } = await fileHandle.read(buffer, 0, readLength, 0);

      if (bytesRead > maximumBytes) {
        throw new FileSizeLimitExceededError(targetPath, maximumBytes);
      }

      return buffer.toString(encoding, 0, bytesRead);
    } finally {
      await fileHandle.close();
    }
  }

  private validateMaximumBytes(maximumBytes: number): void {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
      throw new RangeError("maximumBytes must be a non-negative safe integer.");
    }
  }

  private determineKind(stats: Stats): FileSystemEntryKind {
    if (stats.isFile()) {
      return "file";
    }

    if (stats.isDirectory()) {
      return "directory";
    }

    if (stats.isSymbolicLink()) {
      return "symbolic_link";
    }

    return "other";
  }

  private determineDirentKind(dirent: Dirent): FileSystemEntryKind {
    if (dirent.isFile()) {
      return "file";
    }

    if (dirent.isDirectory()) {
      return "directory";
    }

    if (dirent.isSymbolicLink()) {
      return "symbolic_link";
    }

    return "other";
  }

  private isMissingPathError(error: unknown): boolean {
    if (!error || typeof error !== "object" || !("code" in error)) {
      return false;
    }

    const code = String(error.code);

    return code === "ENOENT" || code === "ENOTDIR";
  }

  private createFileSystemError(code: string, message: string): Error {
    const error = new Error(message) as Error & {
      code: string;
    };

    error.code = code;

    return error;
  }

  private toOptionalIsoDate(
    value: Date,
    milliseconds: number,
  ): string | undefined {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      return undefined;
    }

    if (!Number.isFinite(value.getTime())) {
      return undefined;
    }

    return value.toISOString();
  }
}
