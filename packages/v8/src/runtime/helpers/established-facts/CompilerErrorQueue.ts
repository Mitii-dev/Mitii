import type { CompilerErrorItem } from "./Types";
import { collectToolText } from "./ObservationSummaries";

const COMPILER_ERROR_LINE =
  /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.+)$/gm;

const MAX_COMPILER_QUEUE_ITEMS = 24;
const MAX_COMPILER_QUEUE_GROUPS = 8;

export function extractCompilerErrorQueue(
  output?: unknown,
  outputPreview?: string,
): string | undefined {
  const items = parseCompilerErrorItems(output, outputPreview);
  if (items.length === 0) {
    return undefined;
  }
  const grouped = groupCompilerErrorsByCode(items);
  const groupLines = grouped.slice(0, MAX_COMPILER_QUEUE_GROUPS).map((group) => {
    const locations = group.items
      .slice(0, 8)
      .map((item) => `${item.path}:${item.line}`)
      .join(", ");
    const extra =
      group.items.length > 8 ? ` (+${group.items.length - 8} more)` : "";
    return `${group.code} (${group.items.length} in ${group.fileCount} file(s)): ${locations}${extra}`;
  });
  const moreGroups =
    grouped.length > MAX_COMPILER_QUEUE_GROUPS
      ? ` (+${grouped.length - MAX_COMPILER_QUEUE_GROUPS} more codes)`
      : "";
  return [
    `Remaining compiler errors (${items.length}) grouped by code — fix every listed class across its files this turn, up to the mutation batch cap; do not stop after the first diagnostic.`,
    ...groupLines,
    moreGroups,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function extractOutOfScopePaths(
  warnings: readonly string[] | undefined,
): string[] {
  if (!warnings || warnings.length === 0) {
    return [];
  }
  const paths: string[] = [];
  const pattern = /Path "([^"]+)" is outside granted pathScopes/g;
  for (const warning of warnings) {
    for (const match of warning.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) {
        paths.push(value);
      }
    }
  }
  return paths;
}

export function extractCompilerErrorPaths(
  output?: unknown,
  outputPreview?: string,
): string[] {
  return [
    ...new Set(parseCompilerErrorItems(output, outputPreview).map((item) => item.path)),
  ];
}

export function parseCompilerErrorItems(
  output?: unknown,
  outputPreview?: string,
): CompilerErrorItem[] {
  const text = collectToolText(output, outputPreview);
  if (!text) {
    return [];
  }

  const items: CompilerErrorItem[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(COMPILER_ERROR_LINE)) {
    const path = match[1]?.trim();
    const line = match[2];
    const code = match[3];
    const message = match[4]?.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!path || !line || !code || !message) {
      continue;
    }
    const key = `${path}:${line}:${code}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({ path, line, code, message });
    if (items.length >= MAX_COMPILER_QUEUE_ITEMS) {
      break;
    }
  }
  return items;
}

function groupCompilerErrorsByCode(
  items: readonly CompilerErrorItem[],
): Array<{ code: string; fileCount: number; items: CompilerErrorItem[] }> {
  const byCode = new Map<string, CompilerErrorItem[]>();
  for (const item of items) {
    const existing = byCode.get(item.code);
    if (existing) {
      existing.push(item);
    } else {
      byCode.set(item.code, [item]);
    }
  }
  return [...byCode.entries()]
    .map(([code, grouped]) => ({
      code,
      fileCount: new Set(grouped.map((item) => item.path)).size,
      items: grouped,
    }))
    .sort((left, right) => right.items.length - left.items.length);
}

