/**
 * Filesystem-walk text search — test / last-resort backend when ripgrep is unavailable.
 */

import * as path from "node:path";

import type { WorkspaceFileSystemPort } from "../contracts/ports/WorkspaceFileSystemPort";
import type {
  WorkspaceTextSearchPort,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from "../contracts/ports/WorkspaceTextSearchPort";
import { DEFAULT_MAX_SEARCH_FILE_BYTES } from "../defaults";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import { shouldSkipSearchWalkEntry } from "../internal/SearchWalkIgnore";

const MAX_SEARCH_FILES_VISITED = 20_000;

export class FileSystemWorkspaceTextSearchAdapter
  implements WorkspaceTextSearchPort
{
  constructor(private readonly fileSystem: WorkspaceFileSystemPort) {}

  public async search(
    request: WorkspaceTextSearchRequest,
  ): Promise<WorkspaceTextSearchResult> {
    const matches: WorkspaceTextSearchResult["matches"] = [];
    let truncated = false;
    let filesVisited = 0;
    let hitVisitCap = false;

    const matchesLine = (line: string): boolean => {
      if (request.mode === "regex") {
        const flags = request.caseSensitive ? "" : "i";
        const regex = new RegExp(request.query, flags);
        regex.lastIndex = 0;
        return regex.test(line);
      }
      const haystack = request.caseSensitive ? line : line.toLowerCase();
      const needle = request.caseSensitive
        ? request.query
        : request.query.toLowerCase();
      return haystack.includes(needle);
    };

    const scanFile = async (
      realPath: string,
      relativePath: string,
    ): Promise<void> => {
      if (matches.length >= request.maxMatches || hitVisitCap) return;
      if (!isPathWithinGrant(relativePath, request.pathScopes)) return;
      if (filesVisited >= MAX_SEARCH_FILES_VISITED) {
        hitVisitCap = true;
        truncated = true;
        return;
      }
      const stat = await this.fileSystem.lstat(realPath);
      if (stat.kind !== "file" || stat.sizeBytes > DEFAULT_MAX_SEARCH_FILE_BYTES) {
        return;
      }
      filesVisited += 1;
      const read = await this.fileSystem.readFile(realPath, {
        maxBytes: DEFAULT_MAX_SEARCH_FILE_BYTES,
      });
      const lines = read.content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (!matchesLine(line)) continue;
        const sanitized = sanitizeTextOutput(line, 2_000);
        matches.push({
          path: relativePath,
          line: i + 1,
          text: sanitized.text,
        });
        if (matches.length >= request.maxMatches) {
          truncated = true;
          return;
        }
      }
    };

    const walkDir = async (
      realPath: string,
      relativePath: string,
    ): Promise<void> => {
      if (matches.length >= request.maxMatches || hitVisitCap) return;
      let entries;
      try {
        entries = await this.fileSystem.listDirectory(realPath);
      } catch {
        return;
      }
      const ordered = [...entries].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      for (const entry of ordered) {
        if (matches.length >= request.maxMatches || hitVisitCap) return;
        if (
          entry.name === ".git" ||
          entry.name === "node_modules" ||
          entry.kind === "symlink"
        ) {
          continue;
        }
        const childReal = path.join(realPath, entry.name);
        const childRelative =
          relativePath === "." || relativePath === ""
            ? entry.name
            : `${relativePath.replace(/\/+$/, "")}/${entry.name}`;
        if (
          shouldSkipSearchWalkEntry({
            name: entry.name,
            relativePath: childRelative,
            isDirectory: entry.kind === "directory",
          })
        ) {
          continue;
        }
        if (entry.kind === "directory") {
          await walkDir(childReal, childRelative);
        } else if (entry.kind === "file") {
          await scanFile(childReal, childRelative);
        }
      }
    };

    const rootStat = await this.fileSystem.lstat(request.searchRoot);
    if (rootStat.kind === "file") {
      await scanFile(request.searchRoot, request.searchRootRelative);
    } else if (rootStat.kind === "directory") {
      await walkDir(request.searchRoot, request.searchRootRelative);
    }

    return {
      matches,
      truncated,
      backend: "filesystem",
      ...(hitVisitCap
        ? {
            warning: `Search stopped after visiting ${MAX_SEARCH_FILES_VISITED} files. Pass a narrower path to keep looking.`,
          }
        : {}),
    };
  }
}

function isPathWithinGrant(
  relativePath: string,
  pathScopes: readonly string[],
): boolean {
  if (pathScopes.includes(".")) return true;
  return pathScopes.some(
    (scope) =>
      relativePath === scope || relativePath.startsWith(`${scope}/`),
  );
}
