import * as path from "node:path";

import type { ToolGrant } from "../../../modules/decision-policy";

import type { WorkspaceFileSystemPort } from "../contracts";
import {
  DEFAULT_MAX_SEARCH_FILE_BYTES,
  DEFAULT_MAX_SEARCH_MATCHES,
} from "../defaults";
import {
  resolveContainedPath,
  resolveScopedSearchPath,
} from "../internal/PathContainment";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import { resolveSearchPattern } from "../internal/SearchPattern";
import { shouldSkipSearchWalkEntry } from "../internal/SearchWalkIgnore";
import {
  searchFilesInputSchema,
  searchFilesOutputSchema,
} from "../internal/ToolCatalog";

/**
 * Safety stop for a workspace walk. The old 500-file preload returned
 * empty matches for symbols that existed later in the tree.
 */
const MAX_SEARCH_FILES_VISITED = 20_000;

export async function executeSearchFiles(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  maxOutputBytes: number;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  warnings?: string[];
}> {
  const input = searchFilesInputSchema.parse(params.arguments);
  const contained = await resolveContainedPath({
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
    requestedPath: resolveScopedSearchPath({
      requestedPath: input.path,
      pathScopes: params.grant.pathScopes,
    }),
    pathScopes: params.grant.pathScopes,
  });

  const maxMatches = input.maxMatches ?? DEFAULT_MAX_SEARCH_MATCHES;
  const pattern = resolveSearchPattern({
    query: input.query,
    mode: input.mode,
    caseSensitive: input.caseSensitive,
  });
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const warnings = pattern.warning ? [pattern.warning] : [];

  const rootStat = await params.fileSystem.lstat(contained.realPath);
  const visit = await walkSearch({
    fileSystem: params.fileSystem,
    realPath: contained.realPath,
    relativePath: contained.relativePath,
    kind: rootStat.kind,
    pathScopes: params.grant.pathScopes,
    maxMatches,
    matchesLine: (line) => pattern.matches(line),
    matches,
  });
  const truncated = visit.truncated;
  const redacted = visit.redacted;
  if (visit.hitVisitCap) {
    warnings.push(
      `Search stopped after visiting ${MAX_SEARCH_FILES_VISITED} files. Pass a narrower path to keep looking.`,
    );
  }

  const output = searchFilesOutputSchema.parse({
    query: input.query,
    mode: pattern.mode,
    matches,
    truncated,
  });

  // Bound total payload size.
  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, "utf8") > params.maxOutputBytes) {
    const reduced = {
      ...output,
      matches: output.matches.slice(0, Math.max(1, Math.floor(matches.length / 2))),
      truncated: true,
    };
    return {
      output: searchFilesOutputSchema.parse(reduced),
      truncated: true,
      redacted,
      warnings,
    };
  }

  return { output, truncated, redacted, warnings };
}

async function walkSearch(params: {
  fileSystem: WorkspaceFileSystemPort;
  realPath: string;
  relativePath: string;
  kind: "file" | "directory" | "symlink" | "other";
  pathScopes: readonly string[];
  maxMatches: number;
  matchesLine: (line: string) => boolean;
  matches: Array<{ path: string; line: number; text: string }>;
}): Promise<{ filesVisited: number; truncated: boolean; redacted: boolean; hitVisitCap: boolean }> {
  let filesVisited = 0;
  let truncated = false;
  let redacted = false;
  let hitVisitCap = false;

  const scanFile = async (realPath: string, relativePath: string): Promise<void> => {
    if (params.matches.length >= params.maxMatches || hitVisitCap) {
      return;
    }
    if (!isPathWithinGrant(relativePath, params.pathScopes)) {
      return;
    }
    if (filesVisited >= MAX_SEARCH_FILES_VISITED) {
      hitVisitCap = true;
      truncated = true;
      return;
    }
    const stat = await params.fileSystem.lstat(realPath);
    if (stat.kind !== "file" || stat.sizeBytes > DEFAULT_MAX_SEARCH_FILE_BYTES) {
      return;
    }
    filesVisited += 1;
    const read = await params.fileSystem.readFile(realPath, {
      maxBytes: DEFAULT_MAX_SEARCH_FILE_BYTES,
    });
    const lines = read.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (!params.matchesLine(line)) {
        continue;
      }
      const sanitized = sanitizeTextOutput(line, 2_000);
      redacted = redacted || sanitized.redacted;
      params.matches.push({
        path: relativePath,
        line: i + 1,
        text: sanitized.text,
      });
      if (params.matches.length >= params.maxMatches) {
        truncated = true;
        return;
      }
    }
  };

  const walkDir = async (realPath: string, relativePath: string): Promise<void> => {
    if (params.matches.length >= params.maxMatches || hitVisitCap) {
      return;
    }
    let entries;
    try {
      entries = await params.fileSystem.listDirectory(realPath);
    } catch {
      return;
    }
    const ordered = [...entries].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of ordered) {
      if (params.matches.length >= params.maxMatches || hitVisitCap) {
        return;
      }
      if (entry.name === ".git" || entry.name === "node_modules" || entry.kind === "symlink") {
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

  if (params.kind === "file") {
    await scanFile(params.realPath, params.relativePath);
  } else if (params.kind === "directory") {
    await walkDir(params.realPath, params.relativePath);
  }

  return { filesVisited, truncated, redacted, hitVisitCap };
}

function isPathWithinGrant(
  relativePath: string,
  pathScopes: readonly string[],
): boolean {
  if (pathScopes.includes(".")) {
    return true;
  }
  return pathScopes.some(
    (scope) =>
      relativePath === scope || relativePath.startsWith(`${scope}/`),
  );
}
