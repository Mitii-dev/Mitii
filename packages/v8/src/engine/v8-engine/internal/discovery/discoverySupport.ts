import { DISCOVERY_OBSERVATION_LIMITS } from "../../../../modules/planning";
import type { DiscoveryObservationCollector } from "./discoveryTypes";

export function collectSymbolNames(
  args: Record<string, unknown>,
  resultOutput: unknown,
): string[] {
  const values: string[] = [];
  for (const key of ["symbol", "name", "query", "symbolName", "text"] as const) {
    const value = asString(args[key]);
    if (value && !looksLikePath(value)) {
      values.push(value.slice(0, 200));
    }
  }
  collectSymbolLikeValues(resultOutput, values, 0);
  return unique(values).slice(0, 16);
}

export function collectSymbolLikeValues(
  value: unknown,
  values: string[],
  depth: number,
): void {
  if (depth > 4 || values.length >= 16 || value == null) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed.length >= 2 &&
      trimmed.length <= 200 &&
      !looksLikePath(trimmed) &&
      /^[A-Za-z_][\w.$:]*$/.test(trimmed)
    ) {
      values.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) {
      collectSymbolLikeValues(item, values, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "symbol", "symbolName", "label", "text", "containerName"]) {
      if (key in record) {
        collectSymbolLikeValues(record[key], values, depth + 1);
      }
    }
    if ("children" in record) {
      collectSymbolLikeValues(record.children, values, depth + 1);
    }
    if ("symbols" in record) {
      collectSymbolLikeValues(record.symbols, values, depth + 1);
    }
  }
}

export function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.\w{1,16}$/.test(value);
}

export function attachSymbolsToFileRead(
  collector: DiscoveryObservationCollector,
  path: string,
  reason: string,
  symbols: readonly string[],
): void {
  const normalized = normalizeDiscoveryPath(path);
  if (!normalized) {
    return;
  }
  const existing = collector.filesRead.find(
    (file) => normalizeDiscoveryPath(file.path) === normalized,
  );
  if (existing) {
    const merged = unique([...(existing.symbols ?? []), ...symbols]).slice(0, 16);
    if (merged.length > 0) {
      existing.symbols = merged;
    }
    return;
  }
  pushCappedUniqueByPath(
    collector.filesRead,
    {
      path,
      reason,
      ...(symbols.length > 0 ? { symbols: [...symbols].slice(0, 16) } : {}),
    },
    DISCOVERY_OBSERVATION_LIMITS.maxFilesRead,
    () => {
      collector.omittedFilesRead += 1;
    },
  );
}

/** Cap for injecting deterministic seed-read bodies into the discovery prompt. */
const DISCOVERY_PRE_READ_MAX_CHARS_PER_FILE = 4_000;
const DISCOVERY_PRE_READ_MAX_TOTAL_CHARS = 16_000;

/**
 * Format seed-read file bodies so the discovery model sees content, not only
 * path names (avoids "Already pre-read" re-read loops).
 */
export function formatDiscoveryPreReadEvidence(
  entries: readonly { path: string; content: string }[],
  options?: { maxCharsPerFile?: number; maxTotalChars?: number },
): string {
  const maxPerFile =
    options?.maxCharsPerFile ?? DISCOVERY_PRE_READ_MAX_CHARS_PER_FILE;
  const maxTotal =
    options?.maxTotalChars ?? DISCOVERY_PRE_READ_MAX_TOTAL_CHARS;
  const blocks: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const path = entry.path.trim();
    if (!path || used >= maxTotal) {
      break;
    }
    const remaining = maxTotal - used;
    const budget = Math.min(maxPerFile, remaining);
    let body = entry.content;
    let truncated = false;
    if (body.length > budget) {
      body = body.slice(0, Math.max(0, budget - 20));
      truncated = true;
    }
    const block = truncated
      ? `### ${path}\n${body}\n…(truncated)`
      : `### ${path}\n${body}`;
    blocks.push(block);
    used += block.length;
  }
  if (blocks.length === 0) {
    return "";
  }
  return [
    "<pre_read_evidence trust=\"workspace-read\">",
    ...blocks,
    "</pre_read_evidence>",
  ].join("\n");
}

export function extractDiscoveryReadText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (!output || typeof output !== "object") {
    return "";
  }
  const record = output as Record<string, unknown>;
  for (const key of ["content", "text", "data"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  try {
    return JSON.stringify(output);
  } catch {
    return "";
  }
}

export function buildDiscoveryPrompt(params: {
  query: string;
  objective: string;
  preferredPaths?: readonly string[];
  shapedDiscovery?: {
    preferredPathsLabel?: string;
    discoverySystemHint?: string;
  };
}): { system: string; user: string } {
  const preferred = (params.preferredPaths ?? [])
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .slice(0, 8);
  const defaultPreferredLabel =
    "Preferred paths (read these first; do not start at README.md or package.json unless listed):";
  const preferredBlock =
    preferred.length > 0
      ? [
          params.shapedDiscovery?.preferredPathsLabel ?? defaultPreferredLabel,
          ...preferred.map((path) => `- ${path}`),
        ].join("\n")
      : undefined;
  return {
    system: [
      "You are doing a bounded read-only discovery pass.",
      "Find the concrete files, symbols/functions, and verification checks for the request.",
      "Use only read/search/symbol tools. Do not mutate files, run writes, or draft a plan.",
      "When preferred paths are listed, read those first before exploring elsewhere.",
      "After reading entrypoints, use document_symbol or goto_definition to name the key functions/types to change.",
      "If <pre_read_evidence> is present, those file bodies are already available — do not re-read them unless a nextStartLine/uncovered range is required.",
      params.shapedDiscovery?.discoverySystemHint,
      "Stop after you have identified concrete change surfaces (paths + symbols) and how to verify them.",
    ]
      .filter((part): part is string => Boolean(part))
      .join(" "),
    user: [
      `Request: ${params.query}`,
      `Objective: ${params.objective}`,
      preferredBlock,
      "Read the most relevant entrypoints and nearby tests, then stop.",
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n"),
  };
}

export function collectPaths(args: Record<string, unknown>): string[] {
  const values: string[] = [];
  const single = asString(args.path) ?? asString(args.relativePath);
  if (single) values.push(single);
  const list = args.paths ?? args.files;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item === "string") {
        values.push(item);
        continue;
      }
      const record = asRecord(item);
      const path = asString(record.path) ?? asString(record.relativePath);
      if (path) values.push(path);
    }
  }
  return unique(values);
}

export function collectPathsFromUnknown(value: unknown): string[] {
  const values: string[] = [];
  collectPathLikeValues(value, values, 0);
  return unique(values);
}

export function collectStructuredToolPaths(
  toolName: string,
  args: Record<string, unknown>,
  output: unknown,
): string[] {
  if (toolName === "directory_tree") {
    return collectDirectoryTreePaths(args, output);
  }
  if (toolName === "list_directory") {
    return collectListDirectoryPaths(args, output);
  }
  return [];
}

export function collectDirectoryTreePaths(
  args: Record<string, unknown>,
  output: unknown,
): string[] {
  const record = asRecord(output);
  const root = normalizeDiscoveryPath(
    asString(record.path) ?? asString(args.path) ?? "",
  );
  const values: string[] = [];
  const tree = Array.isArray(record.tree)
    ? record.tree
    : Array.isArray(record.children)
      ? record.children
      : [];
  for (const node of tree) {
    collectTreeNodePaths(node, root, values);
  }
  return unique(values);
}

export function collectTreeNodePaths(
  node: unknown,
  parentPath: string,
  values: string[],
): void {
  const record = asRecord(node);
  const explicitPath = normalizeDiscoveryPath(
    asString(record.path) ?? asString(record.relativePath) ?? "",
  );
  const name = asString(record.name);
  const path =
    explicitPath ||
    (parentPath && name ? `${parentPath}/${name}` : (name ?? ""));
  const children = Array.isArray(record.children) ? record.children : [];
  const kind = asString(record.kind)?.toLowerCase();
  if (children.length > 0) {
    for (const child of children) {
      collectTreeNodePaths(child, path, values);
    }
    return;
  }
  if (kind === "file" || (kind !== "directory" && looksLikeRelativePath(path))) {
    values.push(path);
  }
}

export function collectListDirectoryPaths(
  args: Record<string, unknown>,
  output: unknown,
): string[] {
  const record = asRecord(output);
  const root = normalizeDiscoveryPath(
    asString(record.path) ?? asString(args.path) ?? "",
  );
  const entries = Array.isArray(record.entries)
    ? record.entries
    : Array.isArray(record.files)
      ? record.files
      : [];
  const values: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      const path = normalizeDiscoveryPath(root ? `${root}/${entry}` : entry);
      if (looksLikeRelativePath(path)) {
        values.push(path);
      }
      continue;
    }
    const item = asRecord(entry);
    const explicitPath = normalizeDiscoveryPath(
      asString(item.path) ?? asString(item.relativePath) ?? "",
    );
    const name = asString(item.name);
    const path =
      explicitPath ||
      (root && name ? `${root}/${name}` : (name ?? ""));
    const kind = asString(item.kind)?.toLowerCase();
    if (kind === "directory") {
      continue;
    }
    if (kind === "file" || looksLikeRelativePath(path)) {
      values.push(path);
    }
  }
  return unique(values);
}

export function collectPathLikeValues(
  value: unknown,
  values: string[],
  depth: number,
  keyHint = "",
): void {
  if (depth > 6) {
    return;
  }
  if (typeof value === "string") {
    if (isPathKey(keyHint) && looksLikeRelativePath(value)) {
      values.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathLikeValues(item, values, depth + 1, keyHint);
    }
    return;
  }
  const record = asRecord(value);
  for (const [key, child] of Object.entries(record)) {
    collectPathLikeValues(child, values, depth + 1, key);
  }
}

export function isPathKey(key: string): boolean {
  return /^(?:path|relativePath|file|filePath|uri|target|ref)$/i.test(key);
}

export function looksLikeRelativePath(value: string): boolean {
  const path = value.trim().replace(/\\/g, "/");
  return (
    path.length > 0 &&
    path.length <= 1_000 &&
    !path.startsWith("/") &&
    !path.startsWith("~") &&
    !path.includes("..") &&
    !/^[A-Za-z]:\//.test(path) &&
    (path.includes("/") || /\.\w{1,16}$/.test(path))
  );
}

export function inferReason(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const query = asString(args.query) ?? asString(args.pattern);
  if (query) {
    return `${toolName}: ${query}`.slice(0, 500);
  }
  const path = asString(args.path);
  if (path) {
    return `${toolName} ${path}`.slice(0, 500);
  }
  return `Observed via ${toolName}`;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function normalizeDiscoveryPath(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

export function pushCapped<T>(
  values: T[],
  value: T,
  max: number,
  onOmitted: () => void,
): void {
  if (values.length >= max) {
    onOmitted();
    return;
  }
  values.push(value);
}

export function pushCappedUniqueByPath<T extends { path: string }>(
  values: T[],
  value: T,
  max: number,
  onOmitted: () => void,
): void {
  if (values.some((item) => item.path === value.path)) {
    return;
  }
  pushCapped(values, value, max, onOmitted);
}

export function discoveryOverflowNotes(
  collector: DiscoveryObservationCollector,
): string[] {
  const notes: string[] = [];
  if (collector.omittedFilesRead > 0) {
    notes.push(
      `Discovery omitted ${collector.omittedFilesRead} file read observation(s) after reaching the ${DISCOVERY_OBSERVATION_LIMITS.maxFilesRead} item evidence limit.`,
    );
  }
  if (collector.omittedSearchHits > 0) {
    notes.push(
      `Discovery omitted ${collector.omittedSearchHits} search hit(s) after reaching the ${DISCOVERY_OBSERVATION_LIMITS.maxSearchHits} item evidence limit.`,
    );
  }
  if (collector.omittedVerificationHints > 0) {
    notes.push(
      `Discovery omitted ${collector.omittedVerificationHints} verification hint(s) after reaching the ${DISCOVERY_OBSERVATION_LIMITS.maxVerificationHints} item evidence limit.`,
    );
  }
  return notes.slice(0, DISCOVERY_OBSERVATION_LIMITS.maxNotes);
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
