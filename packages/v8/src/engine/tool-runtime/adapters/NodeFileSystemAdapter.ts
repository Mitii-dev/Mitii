import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileSystemPort,
  WorkspaceStat,
} from "../contracts";
import { shouldSkipSearchWalkEntry } from "../internal/SearchWalkIgnore";

export class NodeWorkspaceFileSystemAdapter implements WorkspaceFileSystemPort {
  public resolve(workspaceRoot: string, relativePath: string): string {
    return path.resolve(workspaceRoot, relativePath);
  }

  public async lstat(absolutePath: string): Promise<WorkspaceStat> {
    const stats = await fs.lstat(absolutePath);
    const mtimeMs = stats.mtimeMs;
    if (stats.isSymbolicLink()) {
      return {
        kind: "symlink",
        sizeBytes: stats.size,
        isSymlink: true,
        mtimeMs,
      };
    }
    if (stats.isDirectory()) {
      return { kind: "directory", sizeBytes: 0, isSymlink: false, mtimeMs };
    }
    if (stats.isFile()) {
      return {
        kind: "file",
        sizeBytes: stats.size,
        isSymlink: false,
        mtimeMs,
      };
    }
    return {
      kind: "other",
      sizeBytes: stats.size,
      isSymlink: false,
      mtimeMs,
    };
  }

  public async realpath(absolutePath: string): Promise<string> {
    return fs.realpath(absolutePath);
  }

  public async readFile(
    absolutePath: string,
    options?: { maxBytes?: number },
  ): Promise<{ content: string; truncated: boolean; bytesRead: number }> {
    const handle = await fs.open(absolutePath, "r");
    try {
      const stats = await handle.stat();
      const maxBytes = options?.maxBytes ?? stats.size;
      const toRead = Math.min(stats.size, maxBytes);
      const buffer = Buffer.alloc(toRead);
      const { bytesRead } = await handle.read(buffer, 0, toRead, 0);
      return {
        content: buffer.subarray(0, bytesRead).toString("utf8"),
        truncated: stats.size > toRead,
        bytesRead,
      };
    } finally {
      await handle.close();
    }
  }

  public async listDirectory(
    absolutePath: string,
  ): Promise<WorkspaceDirectoryEntry[]> {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    return Promise.all(
      entries.map(async (entry) => {
        const full = path.join(absolutePath, entry.name);
        const stats = await fs.lstat(full);
        let kind: WorkspaceDirectoryEntry["kind"] = "other";
        if (stats.isSymbolicLink()) kind = "symlink";
        else if (stats.isDirectory()) kind = "directory";
        else if (stats.isFile()) kind = "file";
        return { name: entry.name, kind };
      }),
    );
  }

  public async readTextFilesUnder(
    absoluteDirectory: string,
    options: {
      workspaceRoot: string;
      maxFiles: number;
      maxFileBytes: number;
    },
  ): Promise<Array<{ relativePath: string; content: string }>> {
    const results: Array<{ relativePath: string; content: string }> = [];
    const workspaceRoot = path.resolve(options.workspaceRoot);
    const root = path.resolve(absoluteDirectory);
    const rootStat = await this.lstat(root);
    if (rootStat.kind === "file") {
      return this.readSingleTextFile(root, options);
    }
    if (rootStat.kind === "symlink") {
      const real = await this.realpath(root);
      const realStat = await this.lstat(real);
      if (realStat.kind === "file") {
        return this.readSingleTextFile(real, options);
      }
      if (realStat.kind !== "directory") {
        return [];
      }
      return this.readTextFilesUnder(real, options);
    }
    if (rootStat.kind !== "directory") {
      return [];
    }

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= options.maxFiles) {
        return;
      }
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= options.maxFiles) {
          return;
        }
        if (entry.name === ".git" || entry.name === "node_modules") {
          continue;
        }
        const full = path.join(dir, entry.name);
        const relativePath = path
          .relative(workspaceRoot, full)
          .replace(/\\/g, "/");
        const stats = await fs.lstat(full);
        if (stats.isSymbolicLink()) {
          continue;
        }
        const isDirectory = stats.isDirectory();
        if (
          shouldSkipSearchWalkEntry({
            name: entry.name,
            relativePath,
            isDirectory,
          })
        ) {
          continue;
        }
        if (isDirectory) {
          await walk(full);
          continue;
        }
        if (!stats.isFile()) {
          continue;
        }
        if (stats.size > options.maxFileBytes) {
          continue;
        }
        const read = await this.readFile(full, {
          maxBytes: options.maxFileBytes,
        });
        results.push({
          relativePath: path.relative(workspaceRoot, full).replace(/\\/g, "/"),
          content: read.content,
        });
      }
    };

    await walk(root);
    return results;
  }

  private async readSingleTextFile(
    absolutePath: string,
    options: {
      workspaceRoot: string;
      maxFileBytes: number;
    },
  ): Promise<Array<{ relativePath: string; content: string }>> {
    const stats = await this.lstat(absolutePath);
    if (stats.kind !== "file" || stats.sizeBytes > options.maxFileBytes) {
      return [];
    }
    const read = await this.readFile(absolutePath, {
      maxBytes: options.maxFileBytes,
    });
    return [
      {
        relativePath: path
          .relative(path.resolve(options.workspaceRoot), absolutePath)
          .replace(/\\/g, "/"),
        content: read.content,
      },
    ];
  }

  public async writeFile(absolutePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }

  public async unlink(absolutePath: string): Promise<void> {
    try {
      await fs.unlink(absolutePath);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  public async mkdirp(absolutePath: string): Promise<void> {
    await fs.mkdir(absolutePath, { recursive: true });
  }

  public async rmdir(
    absolutePath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    try {
      if (options?.recursive) {
        await fs.rm(absolutePath, { recursive: true, force: true });
        return;
      }
      await fs.rmdir(absolutePath);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  public async rename(
    fromAbsolutePath: string,
    toAbsolutePath: string,
  ): Promise<void> {
    await fs.mkdir(path.dirname(toAbsolutePath), { recursive: true });
    await fs.rename(fromAbsolutePath, toAbsolutePath);
  }
}
