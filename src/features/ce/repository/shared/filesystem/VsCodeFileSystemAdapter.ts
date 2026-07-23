import * as path from "node:path";
import * as vscode from "vscode";

import {
  FileSizeLimitExceededError,
  UnsupportedFileSystemOperationError,
} from "./types";

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

export interface VsCodeFileSystemAdapterOptions {
  resolveUri?: (targetPath: string) => vscode.Uri;

  readSymbolicLink?: (targetPath: string, uri: vscode.Uri) => Promise<string>;

  realPath?: (targetPath: string, uri: vscode.Uri) => Promise<string>;

  /**
   * Use the operating-system trash when supported.
   *
   * Recommended for user project files.
   * Disable for internal cache cleanup.
   */
  useTrash?: boolean;
}

export class VsCodeFileSystemAdapter implements FileSystemPort {
  private readonly resolveUri: (targetPath: string) => vscode.Uri;

  private readonly symbolicLinkResolver?: (
    targetPath: string,
    uri: vscode.Uri,
  ) => Promise<string>;

  private readonly realPathResolver?: (
    targetPath: string,
    uri: vscode.Uri,
  ) => Promise<string>;

  private readonly useTrash: boolean;

  constructor(options: VsCodeFileSystemAdapterOptions = {}) {
    this.resolveUri =
      options.resolveUri ?? ((targetPath) => vscode.Uri.file(targetPath));

    this.symbolicLinkResolver = options.readSymbolicLink;

    this.realPathResolver = options.realPath;

    this.useTrash = options.useTrash ?? false;
  }

  public async exists(targetPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.resolveUri(targetPath));

      return true;
    } catch (error) {
      if (this.isMissingPathError(error)) {
        return false;
      }

      throw error;
    }
  }

  public async stat(targetPath: string): Promise<FileSystemStat> {
    const uri = this.resolveUri(targetPath);

    const stats = await vscode.workspace.fs.stat(uri);

    const kind = this.determineKind(stats.type);

    const result: FileSystemStat = {
      path: targetPath,
      kind,
      size: stats.size,
    };

    const createdAt = this.toOptionalIsoDate(stats.ctime);

    const modifiedAt = this.toOptionalIsoDate(stats.mtime);

    if (createdAt) {
      result.createdAt = createdAt;
    }

    if (modifiedAt) {
      result.modifiedAt = modifiedAt;
    }

    if (kind === "symbolic_link" && this.symbolicLinkResolver) {
      result.symbolicLinkTarget = await this.symbolicLinkResolver(
        targetPath,
        uri,
      );
    }

    return result;
  }

  public async readDirectory(
    targetPath: string,
  ): Promise<readonly FileSystemEntry[]> {
    const entries = await vscode.workspace.fs.readDirectory(
      this.resolveUri(targetPath),
    );

    return entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([name, type]): FileSystemEntry => ({
          name,
          path: this.joinTargetPath(targetPath, name),
          kind: this.determineKind(type),
        }),
      );
  }

  public async readText(
    targetPath: string,
    options?: FileSystemReadOptions,
  ): Promise<string> {
    const maximumBytes = options?.maximumBytes;

    if (maximumBytes !== undefined) {
      this.validateMaximumBytes(maximumBytes);

      const stats = await this.stat(targetPath);

      if (stats.size > maximumBytes) {
        throw new FileSizeLimitExceededError(targetPath, maximumBytes);
      }
    }

    const bytes = await vscode.workspace.fs.readFile(
      this.resolveUri(targetPath),
    );

    if (maximumBytes !== undefined && bytes.byteLength > maximumBytes) {
      throw new FileSizeLimitExceededError(targetPath, maximumBytes);
    }

    return new TextDecoder("utf-8").decode(bytes);
  }

  public async writeText(
    targetPath: string,
    content: string,
    options?: FileSystemWriteOptions,
  ): Promise<void> {
    if (options?.createParentDirectories) {
      await this.createDirectory(this.dirname(targetPath), {
        recursive: true,
      });
    }

    const bytes = new TextEncoder().encode(content);

    await vscode.workspace.fs.writeFile(this.resolveUri(targetPath), bytes);
  }

  public async createDirectory(
    targetPath: string,
    _options?: {
      recursive?: boolean;
    },
  ): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.resolveUri(targetPath));
  }

  public async readSymbolicLink(targetPath: string): Promise<string> {
    if (!this.symbolicLinkResolver) {
      throw new UnsupportedFileSystemOperationError(
        "readSymbolicLink",
        "VsCodeFileSystemAdapter",
      );
    }

    return this.symbolicLinkResolver(targetPath, this.resolveUri(targetPath));
  }

  public async realPath(targetPath: string): Promise<string> {
    if (!this.realPathResolver) {
      throw new UnsupportedFileSystemOperationError(
        "realPath",
        "VsCodeFileSystemAdapter",
      );
    }

    return this.realPathResolver(targetPath, this.resolveUri(targetPath));
  }

  public async deleteFile(
    targetPath: string,
    options?: DeleteFileOptions,
  ): Promise<void> {
    try {
      const stat = await this.stat(targetPath);

      if (stat.kind === "directory") {
        throw this.createFileSystemError(
          "EISDIR",
          `Cannot delete directory using deleteFile(): ` + `"${targetPath}".`,
        );
      }

      await vscode.workspace.fs.delete(this.resolveUri(targetPath), {
        recursive: false,
        useTrash: this.useTrash,
      });
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
      const stat = await this.stat(targetPath);

      if (stat.kind !== "directory") {
        throw this.createFileSystemError(
          "ENOTDIR",
          `Cannot delete non-directory using ` +
            `deleteDirectory(): "${targetPath}".`,
        );
      }

      await vscode.workspace.fs.delete(this.resolveUri(targetPath), {
        recursive: options?.recursive ?? false,
        useTrash: this.useTrash,
      });
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
    await vscode.workspace.fs.rename(
      this.resolveUri(sourcePath),
      this.resolveUri(destinationPath),
      {
        overwrite: options?.overwrite ?? false,
      },
    );
  }

  private determineKind(type: vscode.FileType): FileSystemEntryKind {
    if ((type & vscode.FileType.SymbolicLink) !== 0) {
      return "symbolic_link";
    }

    if ((type & vscode.FileType.Directory) !== 0) {
      return "directory";
    }

    if ((type & vscode.FileType.File) !== 0) {
      return "file";
    }

    return "other";
  }

  private isMissingPathError(error: unknown): boolean {
    if (error instanceof vscode.FileSystemError) {
      return error.code === "FileNotFound" || error.code === "EntryNotFound";
    }

    if (error && typeof error === "object" && "code" in error) {
      const code = String(error.code);

      return (
        code === "FileNotFound" ||
        code === "EntryNotFound" ||
        code === "ENOENT" ||
        code === "ENOTDIR"
      );
    }

    return false;
  }

  private joinTargetPath(parent: string, child: string): string {
    const usesWindowsSeparators =
      parent.includes("\\") && !parent.includes("/");

    return usesWindowsSeparators
      ? path.win32.join(parent, child)
      : path.posix.join(parent, child);
  }

  private dirname(targetPath: string): string {
    const usesWindowsSeparators =
      targetPath.includes("\\") && !targetPath.includes("/");

    return usesWindowsSeparators
      ? path.win32.dirname(targetPath)
      : path.posix.dirname(targetPath);
  }

  private validateMaximumBytes(maximumBytes: number): void {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
      throw new RangeError("maximumBytes must be a non-negative safe integer.");
    }
  }

  private createFileSystemError(code: string, message: string): Error {
    const error = new Error(message) as Error & {
      code: string;
    };

    error.code = code;

    return error;
  }

  private toOptionalIsoDate(milliseconds: number): string | undefined {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      return undefined;
    }

    const date = new Date(milliseconds);

    if (!Number.isFinite(date.getTime())) {
      return undefined;
    }

    return date.toISOString();
  }
}
