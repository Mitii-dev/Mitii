import * as path from "node:path";

import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileSystemPort,
  WorkspaceStat,
} from "../contracts";
import { shouldSkipSearchWalkEntry } from "../internal/SearchWalkIgnore";

export interface InMemoryFileNode {
  kind: "file";
  content: string;
}

export interface InMemoryDirectoryNode {
  kind: "directory";
  children: Record<string, InMemoryNode>;
}

export interface InMemorySymlinkNode {
  kind: "symlink";
  target: string;
}

export type InMemoryNode =
  | InMemoryFileNode
  | InMemoryDirectoryNode
  | InMemorySymlinkNode;

/**
 * Deterministic filesystem for Tool Runtime tests.
 * Symlink targets may point outside the workspace root to exercise escape checks.
 */
export class InMemoryFileSystemAdapter implements WorkspaceFileSystemPort {
  constructor(
    private readonly workspaceRoot: string,
    private readonly root: InMemoryDirectoryNode,
  ) {}

  public resolve(workspaceRoot: string, relativePath: string): string {
    return path.resolve(workspaceRoot, relativePath);
  }

  public async lstat(absolutePath: string): Promise<WorkspaceStat> {
    const node = this.lookup(absolutePath, { followSymlinks: false });
    if (!node) {
      throw new Error(`ENOENT: ${absolutePath}`);
    }
    if (node.kind === "file") {
      return {
        kind: "file",
        sizeBytes: Buffer.byteLength(node.content, "utf8"),
        isSymlink: false,
        mtimeMs: 0,
      };
    }
    if (node.kind === "directory") {
      return { kind: "directory", sizeBytes: 0, isSymlink: false, mtimeMs: 0 };
    }
    return { kind: "symlink", sizeBytes: 0, isSymlink: true, mtimeMs: 0 };
  }

  public async realpath(absolutePath: string): Promise<string> {
    const resolved = this.resolveSymlinks(absolutePath);
    if (!this.lookup(resolved, { followSymlinks: false })) {
      throw new Error(`ENOENT: ${absolutePath}`);
    }
    return resolved;
  }

  public async readFile(
    absolutePath: string,
    options?: { maxBytes?: number },
  ): Promise<{ content: string; truncated: boolean; bytesRead: number }> {
    const real = await this.realpath(absolutePath);
    const node = this.lookup(real, { followSymlinks: false });
    if (!node || node.kind !== "file") {
      throw new Error(`ENOENT or not a file: ${absolutePath}`);
    }
    const encoded = Buffer.from(node.content, "utf8");
    const maxBytes = options?.maxBytes ?? encoded.byteLength;
    if (encoded.byteLength <= maxBytes) {
      return {
        content: node.content,
        truncated: false,
        bytesRead: encoded.byteLength,
      };
    }
    const content = encoded.subarray(0, maxBytes).toString("utf8");
    return { content, truncated: true, bytesRead: maxBytes };
  }

  public async listDirectory(
    absolutePath: string,
  ): Promise<WorkspaceDirectoryEntry[]> {
    const real = await this.realpath(absolutePath);
    const node = this.lookup(real, { followSymlinks: false });
    if (!node || node.kind !== "directory") {
      throw new Error(`ENOTDIR: ${absolutePath}`);
    }
    return Object.entries(node.children).map(([name, child]) => ({
      name,
      kind:
        child.kind === "file"
          ? "file"
          : child.kind === "directory"
            ? "directory"
            : "symlink",
    }));
  }

  public async readTextFilesUnder(
    absoluteDirectory: string,
    options: {
      workspaceRoot: string;
      maxFiles: number;
      maxFileBytes: number;
    },
  ): Promise<Array<{ relativePath: string; content: string }>> {
    const real = await this.realpath(absoluteDirectory);
    const results: Array<{ relativePath: string; content: string }> = [];
    const walk = async (abs: string): Promise<void> => {
      const node = this.lookup(abs, { followSymlinks: false });
      if (!node) {
        return;
      }
      if (node.kind === "file") {
        const relativePath = path
          .relative(options.workspaceRoot, abs)
          .replace(/\\/g, "/");
        const read = await this.readFile(abs, {
          maxBytes: options.maxFileBytes,
        });
        results.push({ relativePath, content: read.content });
        return;
      }
      if (node.kind === "directory") {
        for (const name of Object.keys(node.children)) {
          if (results.length >= options.maxFiles) {
            return;
          }
          const childAbs = path.join(abs, name);
          const relativePath = path
            .relative(options.workspaceRoot, childAbs)
            .replace(/\\/g, "/");
          const child = node.children[name];
          if (
            shouldSkipSearchWalkEntry({
              name,
              relativePath,
              isDirectory: child?.kind === "directory",
            })
          ) {
            continue;
          }
          await walk(childAbs);
        }
      }
    };
    await walk(real);
    return results;
  }

  private resolveSymlinks(absolutePath: string, depth = 0): string {
    if (depth > 20) {
      throw new Error(`ELOOP: ${absolutePath}`);
    }
    const node = this.lookup(absolutePath, { followSymlinks: false });
    if (!node) {
      return absolutePath;
    }
    if (node.kind !== "symlink") {
      return absolutePath;
    }
    const target = path.isAbsolute(node.target)
      ? node.target
      : path.resolve(path.dirname(absolutePath), node.target);
    return this.resolveSymlinks(target, depth + 1);
  }

  private lookup(
    absolutePath: string,
    options: { followSymlinks: boolean },
  ): InMemoryNode | undefined {
    const target = options.followSymlinks
      ? this.resolveSymlinks(absolutePath)
      : absolutePath;
    const relative = path.relative(this.workspaceRoot, target);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      // Outside workspace — only resolvable if we planted an absolute symlink target map.
      return this.externalNodes.get(path.resolve(target));
    }
    if (relative === "") {
      return this.root;
    }
    const parts = relative.split(path.sep).filter(Boolean);
    let current: InMemoryNode = this.root;
    for (const part of parts) {
      if (current.kind !== "directory") {
        return undefined;
      }
      const next: InMemoryNode | undefined = current.children[part];
      if (!next) {
        return undefined;
      }
      current = next;
    }
    return current;
  }

  /** Absolute paths outside the workspace used as symlink targets in tests. */
  private readonly externalNodes = new Map<string, InMemoryNode>();

  public plantExternalFile(absolutePath: string, content: string): void {
    this.externalNodes.set(path.resolve(absolutePath), {
      kind: "file",
      content,
    });
  }

  public async writeFile(absolutePath: string, content: string): Promise<void> {
    const absolute = path.resolve(absolutePath);
    const relative = path.relative(this.workspaceRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`EPERM: write outside workspace ${absolutePath}`);
    }
    const parts =
      relative === "" ? [] : relative.split(path.sep).filter(Boolean);
    if (parts.length === 0) {
      throw new Error(`EISDIR: ${absolutePath}`);
    }
    let current: InMemoryDirectoryNode = this.root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i]!;
      const next = current.children[part];
      if (!next) {
        const created: InMemoryDirectoryNode = {
          kind: "directory",
          children: {},
        };
        current.children[part] = created;
        current = created;
        continue;
      }
      if (next.kind !== "directory") {
        throw new Error(`ENOTDIR: ${absolutePath}`);
      }
      current = next;
    }
    const fileName = parts[parts.length - 1]!;
    current.children[fileName] = { kind: "file", content };
  }

  public async unlink(absolutePath: string): Promise<void> {
    const absolute = path.resolve(absolutePath);
    const relative = path.relative(this.workspaceRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
      return;
    }
    const parts = relative.split(path.sep).filter(Boolean);
    let current: InMemoryDirectoryNode = this.root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const next = current.children[parts[i]!];
      if (!next || next.kind !== "directory") {
        return;
      }
      current = next;
    }
    delete current.children[parts[parts.length - 1]!];
  }

  public async mkdirp(absolutePath: string): Promise<void> {
    const absolute = path.resolve(absolutePath);
    const relative = path.relative(this.workspaceRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`EPERM: mkdir outside workspace ${absolutePath}`);
    }
    if (relative === "") {
      return;
    }
    const parts = relative.split(path.sep).filter(Boolean);
    let current: InMemoryDirectoryNode = this.root;
    for (const part of parts) {
      const next = current.children[part];
      if (!next) {
        const created: InMemoryDirectoryNode = {
          kind: "directory",
          children: {},
        };
        current.children[part] = created;
        current = created;
        continue;
      }
      if (next.kind !== "directory") {
        throw new Error(`ENOTDIR: ${absolutePath}`);
      }
      current = next;
    }
  }

  public async rmdir(
    absolutePath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    const absolute = path.resolve(absolutePath);
    const relative = path.relative(this.workspaceRoot, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
      if (relative === "") {
        throw new Error(`EPERM: cannot remove workspace root`);
      }
      return;
    }
    const parts = relative.split(path.sep).filter(Boolean);
    let parent: InMemoryDirectoryNode = this.root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const next = parent.children[parts[i]!];
      if (!next || next.kind !== "directory") {
        return;
      }
      parent = next;
    }
    const name = parts[parts.length - 1]!;
    const target = parent.children[name];
    if (!target) {
      return;
    }
    if (target.kind !== "directory") {
      throw new Error(`ENOTDIR: ${absolutePath}`);
    }
    if (!options?.recursive && Object.keys(target.children).length > 0) {
      throw new Error(`ENOTEMPTY: ${absolutePath}`);
    }
    delete parent.children[name];
  }

  public async rename(
    fromAbsolutePath: string,
    toAbsolutePath: string,
  ): Promise<void> {
    const fromAbsolute = path.resolve(fromAbsolutePath);
    const toAbsolute = path.resolve(toAbsolutePath);
    const fromRelative = path.relative(this.workspaceRoot, fromAbsolute);
    const toRelative = path.relative(this.workspaceRoot, toAbsolute);
    if (
      fromRelative.startsWith("..") ||
      path.isAbsolute(fromRelative) ||
      fromRelative === "" ||
      toRelative.startsWith("..") ||
      path.isAbsolute(toRelative) ||
      toRelative === ""
    ) {
      throw new Error(`EPERM: rename outside workspace`);
    }

    const fromParts = fromRelative.split(path.sep).filter(Boolean);
    let fromParent: InMemoryDirectoryNode = this.root;
    for (let i = 0; i < fromParts.length - 1; i += 1) {
      const next = fromParent.children[fromParts[i]!];
      if (!next || next.kind !== "directory") {
        throw new Error(`ENOENT: ${fromAbsolutePath}`);
      }
      fromParent = next;
    }
    const fromName = fromParts[fromParts.length - 1]!;
    const node = fromParent.children[fromName];
    if (!node) {
      throw new Error(`ENOENT: ${fromAbsolutePath}`);
    }

    const existing = this.lookup(toAbsolute, { followSymlinks: false });
    if (existing) {
      throw new Error(`EEXIST: ${toAbsolutePath}`);
    }

    await this.mkdirp(path.dirname(toAbsolute));
    const toParts = toRelative.split(path.sep).filter(Boolean);
    let toParent: InMemoryDirectoryNode = this.root;
    for (let i = 0; i < toParts.length - 1; i += 1) {
      const next = toParent.children[toParts[i]!];
      if (!next || next.kind !== "directory") {
        throw new Error(`ENOENT: ${toAbsolutePath}`);
      }
      toParent = next;
    }
    const toName = toParts[toParts.length - 1]!;
    delete fromParent.children[fromName];
    toParent.children[toName] = node;
  }
}

export function directory(
  children: Record<string, InMemoryNode>,
): InMemoryDirectoryNode {
  return { kind: "directory", children };
}

export function file(content: string): InMemoryFileNode {
  return { kind: "file", content };
}

export function symlink(target: string): InMemorySymlinkNode {
  return { kind: "symlink", target };
}
