import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileSystemPort,
  WorkspaceReadFileOptions,
  WorkspaceReadFileResult,
  WorkspaceStat,
} from "../contracts";
import { shouldSkipSearchWalkEntry } from "../internal/SearchWalkIgnore";
import { selectLineWindow } from "../internal/readFileWindow";

/** Safety cap while seeking to startLine so huge files cannot hang the tool. */
const MAX_SEEK_BYTES = 8_000_000;

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
    options?: WorkspaceReadFileOptions,
  ): Promise<WorkspaceReadFileResult> {
    const handle = await fs.open(absolutePath, "r");
    try {
      const stats = await handle.stat();
      const wantsRange =
        options?.startLine !== undefined ||
        options?.endLine !== undefined ||
        options?.maxLines !== undefined;

      // Prefix-only reads honor maxBytes from offset 0. Ranged reads may scan
      // farther (up to MAX_SEEK_BYTES) so late startLine values stay reachable,
      // then the returned window is still bounded by maxBytes.
      const scanLimit = wantsRange
        ? Math.min(stats.size, MAX_SEEK_BYTES)
        : Math.min(stats.size, options?.maxBytes ?? stats.size);

      const buffer = Buffer.alloc(scanLimit);
      const { bytesRead } = await handle.read(buffer, 0, scanLimit, 0);
      const raw = buffer.subarray(0, bytesRead).toString("utf8");
      const loadedComplete = stats.size <= scanLimit;

      let text = raw;
      if (!loadedComplete && raw.length > 0 && !raw.endsWith("\n") && !wantsRange) {
        const lastNl = Math.max(raw.lastIndexOf("\n"), raw.lastIndexOf("\r"));
        if (lastNl >= 0) {
          text = raw.slice(0, lastNl);
        }
      }

      const maxChars =
        options?.maxBytes !== undefined && Number.isFinite(options.maxBytes)
          ? options.maxBytes
          : undefined;

      const window = selectLineWindow({
        text,
        startLine: options?.startLine,
        endLine: options?.endLine,
        maxLines: options?.maxLines,
        maxChars: wantsRange ? maxChars : undefined,
        textIsComplete: loadedComplete,
      });

      // Prefix path without explicit range: apply byte budget via window maxChars
      // when the loaded prefix itself was not already limited to maxBytes.
      const finalized =
        !wantsRange && maxChars !== undefined && window.content.length > maxChars
          ? selectLineWindow({
              text: window.content,
              maxChars,
              textIsComplete: window.eof,
            })
          : window;

      const truncated =
        finalized.truncated ||
        !loadedComplete ||
        Boolean(finalized.truncationReason);

      return {
        content: finalized.content,
        truncated,
        bytesRead: Buffer.byteLength(finalized.content, "utf8"),
        startLine: finalized.startLine,
        endLine: finalized.endLine,
        ...(finalized.totalLines !== undefined
          ? { totalLines: finalized.totalLines }
          : {}),
        eof: Boolean(finalized.eof && loadedComplete),
        ...(finalized.nextStartLine !== undefined
          ? { nextStartLine: finalized.nextStartLine }
          : !finalized.eof || !loadedComplete
            ? {
                nextStartLine:
                  finalized.endLine >= finalized.startLine
                    ? finalized.endLine + 1
                    : Math.max(1, options?.startLine ?? 1),
              }
            : {}),
        ...(truncated
          ? {
              truncationReason:
                finalized.truncationReason ??
                (!loadedComplete ? ("byte_cap" as const) : ("line_range" as const)),
            }
          : {}),
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
