import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileSystemPort,
  WorkspaceStat,
} from "../contracts";

export class NodeWorkspaceFileSystemAdapter implements WorkspaceFileSystemPort {
  public resolve(workspaceRoot: string, relativePath: string): string {
    return path.resolve(workspaceRoot, relativePath);
  }

  public async lstat(absolutePath: string): Promise<WorkspaceStat> {
    const stats = await fs.lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      return { kind: "symlink", sizeBytes: stats.size, isSymlink: true };
    }
    if (stats.isDirectory()) {
      return { kind: "directory", sizeBytes: 0, isSymlink: false };
    }
    if (stats.isFile()) {
      return { kind: "file", sizeBytes: stats.size, isSymlink: false };
    }
    return { kind: "other", sizeBytes: stats.size, isSymlink: false };
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
        const stats = await fs.lstat(full);
        if (stats.isSymbolicLink()) {
          continue;
        }
        if (stats.isDirectory()) {
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

    await walk(absoluteDirectory);
    return results;
  }
}
