import * as path from "node:path";
import {
  FileSystemEntry,
  FileSystemEntryKind,
  FileSystemPort,
  FileSystemReadOptions,
  FileSystemStat,
  FileSystemWriteOptions,
  FileSizeLimitExceededError,
  DeleteFileOptions,
  DeleteDirectoryOptions,
  RenamePathOptions,
} from "./types";
import {
  byteLength,
  createFileExistsError,
  createFileSystemError,
  createInvalidArgumentError,
  createIsDirectoryError,
  createNotDirectoryError,
  createNotFoundError,
  normalize,
  validateMaximumBytes,
  type InMemoryDirectoryRecord,
  type InMemoryFileRecord,
  type InMemoryFileSystemSeedEntry,
  type InMemorySymbolicLinkRecord,
} from "./inMemoryFileSystemSupport";

export type { InMemoryFileSystemSeedEntry } from "./inMemoryFileSystemSupport";

export class InMemoryFileSystemAdapter implements FileSystemPort {
  private readonly files = new Map<string, InMemoryFileRecord>();

  private readonly directories = new Map<string, InMemoryDirectoryRecord>();

  private readonly symbolicLinks = new Map<
    string,
    InMemorySymbolicLinkRecord
  >();

  constructor(entries: readonly InMemoryFileSystemSeedEntry[] = []) {
    const timestamp = this.now();

    this.directories.set("/", {
      createdAt: timestamp,
      modifiedAt: timestamp,
    });

    for (const entry of entries) {
      this.seed(entry);
    }
  }

  public async exists(targetPath: string): Promise<boolean> {
    const normalized = normalize(targetPath);

    return (
      this.files.has(normalized) ||
      this.directories.has(normalized) ||
      this.symbolicLinks.has(normalized)
    );
  }

  public async stat(targetPath: string): Promise<FileSystemStat> {
    const normalized = normalize(targetPath);

    const file = this.files.get(normalized);

    if (file) {
      return {
        path: normalized,
        kind: "file",
        size: byteLength(file.content),
        createdAt: file.createdAt,
        modifiedAt: file.modifiedAt,
      };
    }

    const directory = this.directories.get(normalized);

    if (directory) {
      return {
        path: normalized,
        kind: "directory",
        size: 0,
        createdAt: directory.createdAt,
        modifiedAt: directory.modifiedAt,
      };
    }

    const symbolicLink = this.symbolicLinks.get(normalized);

    if (symbolicLink) {
      return {
        path: normalized,
        kind: "symbolic_link",
        size: byteLength(symbolicLink.target),
        createdAt: symbolicLink.createdAt,
        modifiedAt: symbolicLink.modifiedAt,
        symbolicLinkTarget: symbolicLink.target,
      };
    }

    throw createNotFoundError(normalized);
  }

  public async readDirectory(
    targetPath: string,
  ): Promise<readonly FileSystemEntry[]> {
    const normalized = normalize(targetPath);

    if (!this.directories.has(normalized)) {
      if (await this.exists(normalized)) {
        throw createNotDirectoryError(normalized);
      }

      throw createNotFoundError(normalized);
    }

    const children = new Map<string, FileSystemEntry>();

    this.collectImmediateChildren(
      normalized,
      this.files.keys(),
      "file",
      children,
    );

    this.collectImmediateChildren(
      normalized,
      this.directories.keys(),
      "directory",
      children,
    );

    this.collectImmediateChildren(
      normalized,
      this.symbolicLinks.keys(),
      "symbolic_link",
      children,
    );

    return [...children.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  public async readText(
    targetPath: string,
    options?: FileSystemReadOptions,
  ): Promise<string> {
    const normalized = normalize(targetPath);

    const resolved = await this.resolvePath(normalized);

    const file = this.files.get(resolved);

    if (!file) {
      if (this.directories.has(resolved)) {
        throw createIsDirectoryError(resolved);
      }

      throw createNotFoundError(resolved);
    }

    const maximumBytes = options?.maximumBytes;

    if (maximumBytes !== undefined) {
      validateMaximumBytes(maximumBytes);

      if (byteLength(file.content) > maximumBytes) {
        throw new FileSizeLimitExceededError(normalized, maximumBytes);
      }
    }

    return file.content;
  }

  public async writeText(
    targetPath: string,
    content: string,
    options?: FileSystemWriteOptions,
  ): Promise<void> {
    const normalized = normalize(targetPath);

    const parent = path.posix.dirname(normalized);

    if (!this.directories.has(parent)) {
      if (options?.createParentDirectories) {
        await this.createDirectory(parent, {
          recursive: true,
        });
      } else {
        throw createNotFoundError(parent);
      }
    }

    if (this.directories.has(normalized)) {
      throw createIsDirectoryError(normalized);
    }

    const timestamp = this.now();
    const existing = this.files.get(normalized);

    this.symbolicLinks.delete(normalized);

    this.files.set(normalized, {
      content,
      createdAt: existing?.createdAt ?? timestamp,
      modifiedAt: timestamp,
    });

    this.touchDirectory(parent);
  }

  public async createDirectory(
    targetPath: string,
    options?: {
      recursive?: boolean;
    },
  ): Promise<void> {
    const normalized = normalize(targetPath);

    if (this.files.has(normalized)) {
      throw createFileExistsError(normalized);
    }

    if (this.directories.has(normalized)) {
      return;
    }

    const parent = path.posix.dirname(normalized);

    if (parent !== normalized && !this.directories.has(parent)) {
      if (options?.recursive) {
        await this.createDirectory(parent, {
          recursive: true,
        });
      } else {
        throw createNotFoundError(parent);
      }
    }

    const timestamp = this.now();

    this.directories.set(normalized, {
      createdAt: timestamp,
      modifiedAt: timestamp,
    });

    this.touchDirectory(parent);
  }

  public async deleteFile(
    targetPath: string,
    options?: DeleteFileOptions,
  ): Promise<void> {
    const normalized = normalize(targetPath);

    if (this.directories.has(normalized)) {
      throw createIsDirectoryError(normalized);
    }

    const isFile = this.files.has(normalized);
    const isLink = this.symbolicLinks.has(normalized);

    if (!isFile && !isLink) {
      if (options?.ignoreIfNotExists) {
        return;
      }
      throw createNotFoundError(normalized);
    }

    this.files.delete(normalized);
    this.symbolicLinks.delete(normalized);
    this.touchDirectory(path.posix.dirname(normalized));
  }

  public async deleteDirectory(
    targetPath: string,
    options?: DeleteDirectoryOptions,
  ): Promise<void> {
    const normalized = normalize(targetPath);

    if (normalized === "/") {
      throw createInvalidArgumentError(
        normalized,
        "Cannot delete root directory.",
      );
    }

    if (!this.directories.has(normalized)) {
      if (this.files.has(normalized) || this.symbolicLinks.has(normalized)) {
        throw createNotDirectoryError(normalized);
      }
      if (options?.ignoreIfNotExists) {
        return;
      }
      throw createNotFoundError(normalized);
    }

    const prefix = `${normalized}/`;

    // Check if empty
    const hasChildren = [
      ...this.files.keys(),
      ...this.directories.keys(),
      ...this.symbolicLinks.keys(),
    ].some((p) => p.startsWith(prefix));

    if (hasChildren && !options?.recursive) {
      throw createFileSystemError(
        "ENOTEMPTY",
        `Directory not empty: "${normalized}".`,
      );
    }

    // Recursive deletion
    if (hasChildren) {
      for (const p of this.files.keys())
        if (p.startsWith(prefix)) this.files.delete(p);
      for (const p of this.directories.keys())
        if (p.startsWith(prefix)) this.directories.delete(p);
      for (const p of this.symbolicLinks.keys())
        if (p.startsWith(prefix)) this.symbolicLinks.delete(p);
    }

    this.directories.delete(normalized);
    this.touchDirectory(path.posix.dirname(normalized));
  }

  public async rename(
    sourcePath: string,
    destinationPath: string,
    options?: RenamePathOptions,
  ): Promise<void> {
    const source = normalize(sourcePath);
    const dest = normalize(destinationPath);

    if (!(await this.exists(source))) {
      throw createNotFoundError(source);
    }

    if (await this.exists(dest)) {
      if (!options?.overwrite) {
        throw createFileExistsError(dest);
      }
      // If overwriting, clear the destination first based on its type
      if (this.directories.has(dest)) {
        await this.deleteDirectory(dest, { recursive: true });
      } else {
        await this.deleteFile(dest);
      }
    }

    const destParent = path.posix.dirname(dest);
    if (!this.directories.has(destParent)) {
      throw createNotFoundError(destParent);
    }

    // Move logic
    if (this.files.has(source)) {
      this.files.set(dest, this.files.get(source)!);
      this.files.delete(source);
    } else if (this.symbolicLinks.has(source)) {
      this.symbolicLinks.set(dest, this.symbolicLinks.get(source)!);
      this.symbolicLinks.delete(source);
    } else if (this.directories.has(source)) {
      this.directories.set(dest, this.directories.get(source)!);
      this.directories.delete(source);

      // Deep move for directory children
      const sourcePrefix = `${source}/`;
      const moveChildren = (map: Map<string, any>) => {
        for (const [p, val] of Array.from(map.entries())) {
          if (p.startsWith(sourcePrefix)) {
            const newPath = dest + p.slice(source.length);
            map.set(newPath, val);
            map.delete(p);
          }
        }
      };

      moveChildren(this.files);
      moveChildren(this.directories);
      moveChildren(this.symbolicLinks);
    }

    this.touchDirectory(path.posix.dirname(source));
    this.touchDirectory(destParent);
  }

  public async readSymbolicLink(targetPath: string): Promise<string> {
    const normalized = normalize(targetPath);

    const symbolicLink = this.symbolicLinks.get(normalized);

    if (!symbolicLink) {
      if (await this.exists(normalized)) {
        throw createInvalidArgumentError(
          normalized,
          "Path is not a symbolic link.",
        );
      }

      throw createNotFoundError(normalized);
    }

    return symbolicLink.target;
  }

  public async realPath(targetPath: string): Promise<string> {
    const normalized = normalize(targetPath);

    const resolved = await this.resolvePath(normalized);

    if (!(await this.exists(resolved))) {
      throw createNotFoundError(resolved);
    }

    return resolved;
  }

  /**
   * Test helper for creating a symbolic link.
   */
  public async createSymbolicLink(
    targetPath: string,
    linkTarget: string,
  ): Promise<void> {
    const normalized = normalize(targetPath);

    const parent = path.posix.dirname(normalized);

    if (!this.directories.has(parent)) {
      throw createNotFoundError(parent);
    }

    if (await this.exists(normalized)) {
      throw createFileExistsError(normalized);
    }

    const timestamp = this.now();

    this.symbolicLinks.set(normalized, {
      target: linkTarget,
      createdAt: timestamp,
      modifiedAt: timestamp,
    });

    this.touchDirectory(parent);
  }

  /**
   * Test helper for inspecting stored file contents.
   */
  public getFileContent(targetPath: string): string | undefined {
    return this.files.get(normalize(targetPath))?.content;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private seed(entry: InMemoryFileSystemSeedEntry): void {
    const normalized = normalize(entry.path);

    const createdAt = entry.createdAt ?? this.now();

    const modifiedAt = entry.modifiedAt ?? createdAt;

    this.ensureParentDirectories(normalized);

    switch (entry.kind) {
      case "file": {
        this.files.set(normalized, {
          content: entry.content,
          createdAt,
          modifiedAt,
        });

        return;
      }

      case "directory": {
        this.directories.set(normalized, {
          createdAt,
          modifiedAt,
        });

        return;
      }

      case "symbolic_link": {
        this.symbolicLinks.set(normalized, {
          target: entry.target,
          createdAt,
          modifiedAt,
        });

        return;
      }
    }
  }

  private ensureParentDirectories(targetPath: string): void {
    const parent = path.posix.dirname(normalize(targetPath));

    const segments = parent.split("/").filter(Boolean);

    let current = "/";

    for (const segment of segments) {
      current = path.posix.join(current, segment);

      if (!this.directories.has(current)) {
        const timestamp = this.now();

        this.directories.set(current, {
          createdAt: timestamp,
          modifiedAt: timestamp,
        });
      }
    }
  }

  private collectImmediateChildren(
    parent: string,
    paths: IterableIterator<string>,
    kind: FileSystemEntryKind,
    output: Map<string, FileSystemEntry>,
  ): void {
    for (const candidate of paths) {
      if (candidate === parent) {
        continue;
      }

      if (path.posix.dirname(candidate) !== parent) {
        continue;
      }

      const name = path.posix.basename(candidate);

      output.set(name, {
        name,
        path: candidate,
        kind,
      });
    }
  }

  private async resolvePath(targetPath: string): Promise<string> {
    let current = normalize(targetPath);
    const visited = new Set<string>();

    while (this.symbolicLinks.has(current)) {
      if (visited.has(current)) {
        const error = new Error(
          `Symbolic-link cycle detected at "${current}".`,
        );

        error.name = "SymbolicLinkCycleError";

        throw error;
      }

      visited.add(current);

      const symbolicLink = this.symbolicLinks.get(current);

      if (!symbolicLink) {
        break;
      }

      current = path.posix.isAbsolute(symbolicLink.target)
        ? normalize(symbolicLink.target)
        : normalize(
            path.posix.join(path.posix.dirname(current), symbolicLink.target),
          );
    }

    return current;
  }

  private touchDirectory(targetPath: string): void {
    const normalized = normalize(targetPath);

    const directory = this.directories.get(normalized);

    if (directory) {
      directory.modifiedAt = this.now();
    }
  }
}
