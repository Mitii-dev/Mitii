/**
 * When SituationPack has no focus paths, seed discovery from the workspace root
 * (list + capped high-value reads) so plan mode is not seed-only empty.
 */

import type { DiscoveryObservation } from "../../../modules/planning";
import type { DiscoveryPassBudget } from "../../../modules/window-budget";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import type { RuntimeToolExecutorPort } from "../../ports/RuntimeToolExecutorPort";
import { isProductiveDiscoveryReadPath } from "./PlanDiscoveryQuality";

/** Docs / content — preferred over manifests (manifests are non-productive). */
const DOC_NAMES = new Set([
  "requirement.txt",
  "requirements.txt",
  "readme.md",
  "readme",
  "agents.md",
  "contributing.md",
  "authoring.md",
]);

/** Manifests — useful context but not productive discovery reads. */
const MANIFEST_NAMES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "cargo.toml",
  "go.mod",
  "pyproject.toml",
]);

const CONTENT_EXT = /\.(html?|md|txt|mjs|js|ts|tsx|jsx)$/i;

export interface DiscoveryRootPeekResult {
  observation: DiscoveryObservation;
  toolCalls: number;
  fileReads: number;
  searches: number;
  reasonCodes: string[];
}

function entryNames(output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const entries = (output as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  const names: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      names.push(entry);
      continue;
    }
    if (entry && typeof entry === "object" && "name" in entry) {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0 && !name.startsWith(".")) {
        names.push(name);
      }
    }
  }
  return names;
}

function globMatches(output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const matches = (output as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) return [];
  const paths: string[] = [];
  for (const match of matches) {
    if (typeof match === "string") {
      paths.push(match);
      continue;
    }
    if (match && typeof match === "object" && "path" in match) {
      const path = (match as { path?: unknown }).path;
      if (typeof path === "string" && path.length > 0) {
        paths.push(path);
      }
    }
  }
  return paths;
}

/** Prefer productive docs/source, then manifests — never deep trees. */
export function pickRootPeekPaths(names: readonly string[], max: number): string[] {
  const ranked: { path: string; rank: number }[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (DOC_NAMES.has(lower)) {
      ranked.push({ path: name, rank: 0 });
      continue;
    }
    if (CONTENT_EXT.test(name) && !name.includes("/")) {
      ranked.push({
        path: name,
        rank: isProductiveDiscoveryReadPath(name) ? 1 : 3,
      });
      continue;
    }
    if (MANIFEST_NAMES.has(lower)) {
      ranked.push({ path: name, rank: 2 });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of ranked) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item.path);
    if (out.length >= max) break;
  }
  return out;
}

/** Cheap query tokens for a bounded glob when focus is empty. */
export function discoveryQueryGlobHints(objective: string): string[] {
  const text = objective.toLowerCase();
  const hints: string[] = [];
  if (/\breact\b/.test(text) || /\bfrontend\b/.test(text)) {
    hints.push("**/react*.mjs", "cases/js/atomic/frontend/**/task.yaml");
  }
  if (/\btest\b|\bcases?\b|\boracle\b/.test(text)) {
    hints.push("**/AUTHORING.md", "docs/AUTHORING.md", "docs/CHECKS.md");
  }
  if (hints.length === 0) {
    hints.push("**/README.md", "docs/**/*.md");
  }
  return hints.slice(0, 3);
}

/**
 * list_directory "." (+ optional query globs) then read a few high-value paths.
 */
export async function peekDiscoveryFromWorkspaceRoot(params: {
  observation: DiscoveryObservation;
  tools: RuntimeToolExecutorPort;
  grant: GrantSurface;
  budget: DiscoveryPassBudget;
  toolCalls: number;
  fileReads: number;
  searches?: number;
  objective?: string;
}): Promise<DiscoveryRootPeekResult> {
  const reasonCodes: string[] = [];
  let { toolCalls, fileReads } = params;
  let searches = params.searches ?? 0;
  const observation = {
    ...params.observation,
    filesRead: [...(params.observation.filesRead ?? [])],
    searchHits: [...(params.observation.searchHits ?? [])],
  };

  if (toolCalls >= params.budget.maxToolCalls) {
    return { observation, toolCalls, fileReads, searches, reasonCodes };
  }

  const listed = await params.tools.execute({
    toolId: "list_directory",
    args: { path: "." },
    grant: params.grant,
    invocationId: `discovery_list_${toolCalls + 1}`,
  });
  toolCalls += 1;

  if (!listed.ok) {
    reasonCodes.push("discovery_root_list_failed");
    return { observation, toolCalls, fileReads, searches, reasonCodes };
  }

  reasonCodes.push("discovery_root_listed");
  const names = entryNames(listed.output);
  const candidatePaths = [...names];

  const objective = params.objective?.trim() ?? "";
  if (objective.length > 0 && toolCalls < params.budget.maxToolCalls) {
    for (const pattern of discoveryQueryGlobHints(objective)) {
      if (toolCalls >= params.budget.maxToolCalls) break;
      if (searches >= params.budget.maxSearches) break;
      const globbed = await params.tools.execute({
        toolId: "glob_files",
        args: { pattern, maxResults: 8 },
        grant: params.grant,
        invocationId: `discovery_glob_${toolCalls + 1}`,
      });
      toolCalls += 1;
      searches += 1;
      if (!globbed.ok) {
        reasonCodes.push("discovery_root_glob_failed");
        continue;
      }
      reasonCodes.push("discovery_root_glob_ok");
      const matches = globMatches(globbed.output);
      observation.searchHits = [
        ...(observation.searchHits ?? []),
        ...matches.slice(0, 8).map((path) => ({
          path,
          reason: "discovery_root_glob",
        })),
      ];
      for (const path of matches) {
        candidatePaths.push(path);
      }
    }
  }

  const remainingTools = Math.max(0, params.budget.maxToolCalls - toolCalls);
  const remainingReads = Math.max(0, params.budget.maxFileReads - fileReads);
  const toPeek = pickRootPeekPaths(
    candidatePaths,
    Math.min(4, remainingTools, remainingReads),
  );

  for (const path of toPeek) {
    if (toolCalls >= params.budget.maxToolCalls) break;
    if (fileReads >= params.budget.maxFileReads) break;
    const result = await params.tools.execute({
      toolId: "read_file",
      args: { path },
      grant: params.grant,
      invocationId: `discovery_root_read_${toolCalls + 1}`,
    });
    toolCalls += 1;
    fileReads += 1;
    if (result.ok) {
      observation.filesRead = [
        ...(observation.filesRead ?? []),
        { path, reason: "discovery_root_peek" },
      ];
      reasonCodes.push("discovery_root_read_ok");
    } else {
      reasonCodes.push("discovery_root_read_failed");
    }
  }

  return { observation, toolCalls, fileReads, searches, reasonCodes };
}
