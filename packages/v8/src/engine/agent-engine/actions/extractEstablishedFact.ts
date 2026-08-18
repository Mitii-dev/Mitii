const OBSERVATION_TOOLS = new Set([
  "read_file",
  "read_many_files",
  "search_files",
  "glob_files",
  "list_directory",
  "read_diagnostics",
  "read_package_scripts",
  "analyze_change_impact",
  "run_readonly_command",
  "goto_definition",
  "find_references",
  "file_metadata",
]);

export interface EstablishedFact {
  id: string;
  content: string;
}

/**
 * Compact observation from a successful read/search tool. These are the
 * mid-run facts that must survive auto/hard compaction.
 */
export function extractEstablishedFact(params: {
  toolName: string;
  argumentsValue: unknown;
  output?: unknown;
  outputPreview?: string;
  maxChars?: number;
}): EstablishedFact | undefined {
  if (!OBSERVATION_TOOLS.has(params.toolName)) {
    return undefined;
  }

  const compilerQueue = extractCompilerErrorQueue(
    params.output,
    params.outputPreview,
  );
  if (compilerQueue) {
    const maxChars = Math.max(1, Math.floor(params.maxChars ?? 220), 900);
    const clipped = compilerQueue.slice(0, maxChars);
    if (clipped.length < 8) {
      return undefined;
    }
    return {
      id: "error-queue:compiler",
      content: clipped,
    };
  }

  const locator = resolveLocator(params.toolName, params.argumentsValue, params.output);
  const preview = resolveFinding(params.output, params.outputPreview);
  if (!locator || !preview) {
    return undefined;
  }

  const maxChars = Math.max(1, Math.floor(params.maxChars ?? 220));
  const clipped = preview
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
  if (clipped.length < 8) {
    return undefined;
  }

  return {
    id: `${params.toolName}:${locator}`,
    content: `${locator} => ${clipped}`,
  };
}

export function upsertEstablishedFact(
  facts: EstablishedFact[],
  next: EstablishedFact | undefined,
  options: { maxFacts?: number } = {},
): void {
  if (!next) {
    return;
  }
  const index = facts.findIndex((fact) => fact.id === next.id);
  if (index >= 0) {
    facts[index] = next;
    return;
  }
  facts.push(next);
  const maxFacts = Math.max(1, Math.floor(options.maxFacts ?? 12));
  if (facts.length > maxFacts) {
    facts.splice(0, facts.length - maxFacts);
  }
}

export function dropEstablishedFactsForPaths(
  facts: EstablishedFact[],
  paths: readonly string[],
): void {
  if (paths.length === 0) {
    return;
  }
  const normalized = new Set(
    paths.map((path) => path.trim().replace(/\\/g, "/")).filter(Boolean),
  );
  for (let index = facts.length - 1; index >= 0; index -= 1) {
    const fact = facts[index]!;
    for (const path of normalized) {
      if (fact.id.includes(path) || fact.content.includes(path)) {
        facts.splice(index, 1);
        break;
      }
    }
  }
}

function resolveLocator(
  toolName: string,
  argumentsValue: unknown,
  output: unknown,
): string | undefined {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return toolName;
  }
  const record = argumentsValue as Record<string, unknown>;
  if (typeof record.path === "string" && record.path.trim().length > 0) {
    return withLineRange(record.path.trim(), record.startLine, record.endLine);
  }
  if (Array.isArray(record.paths) && record.paths.length > 0) {
    return record.paths
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      .slice(0, 4)
      .join(",");
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const outputRecord = output as Record<string, unknown>;
    if (
      typeof outputRecord.path === "string" &&
      outputRecord.path.trim().length > 0
    ) {
      return withLineRange(
        outputRecord.path.trim(),
        outputRecord.startLine,
        outputRecord.endLine,
      );
    }
  }
  if (typeof record.query === "string" && record.query.trim().length > 0) {
    return record.query.trim().slice(0, 80);
  }
  if (typeof record.symbol === "string" && record.symbol.trim().length > 0) {
    return record.symbol.trim();
  }
  return toolName;
}

function withLineRange(path: string, startLine: unknown, endLine: unknown): string {
  const start = typeof startLine === "number" ? startLine : undefined;
  const end = typeof endLine === "number" ? endLine : undefined;
  if (!start && !end) {
    return path;
  }
  return `${path}:${start ?? 1}${end ? `-${end}` : ""}`;
}

const COMPILER_ERROR_LINE =
  /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.+)$/gm;

const MAX_COMPILER_QUEUE_ITEMS = 24;
const MAX_COMPILER_QUEUE_GROUPS = 8;

export interface CompilerErrorItem {
  path: string;
  line: string;
  code: string;
  message: string;
}

/**
 * Compact remaining-error list from tsc / compiler tool output so the
 * diagnostic queue survives hard compaction on small windows.
 * Groups by error code so the model fixes a class per turn, not one line.
 */
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

function collectToolText(output?: unknown, outputPreview?: string): string {
  const parts: string[] = [];
  if (typeof output === "string") {
    parts.push(output);
  } else if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    for (const key of ["stdout", "stderr", "output", "text", "content"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        parts.push(value);
      }
    }
  }
  if (outputPreview && outputPreview.trim().length > 0) {
    parts.push(outputPreview);
  }
  return parts.join("\n");
}

function resolveFinding(output: unknown, outputPreview?: string): string | undefined {
  if (typeof output === "string" && output.trim().length > 0) {
    return output;
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (Array.isArray(record.diagnostics)) {
      return summarizeDiagnostics(record.diagnostics);
    }
    if (Array.isArray(record.matches)) {
      return summarizeMatches(record.matches);
    }
    if (Array.isArray(record.entries)) {
      return summarizeEntries(record.entries);
    }
    if (Array.isArray(record.files)) {
      return summarizeFiles(record.files);
    }
    if (typeof record.content === "string" && record.content.trim().length > 0) {
      return record.content;
    }
    if (typeof record.text === "string" && record.text.trim().length > 0) {
      return record.text;
    }
    if (typeof record.output === "string" && record.output.trim().length > 0) {
      return record.output;
    }
  }
  if (outputPreview && outputPreview.trim().length > 0) {
    return outputPreview;
  }
  return undefined;
}

function summarizeDiagnostics(values: unknown[]): string | undefined {
  return values
    .slice(0, 6)
    .map((value) => {
      if (!value || typeof value !== "object") {
        return "";
      }
      const record = value as Record<string, unknown>;
      return [
        typeof record.path === "string" ? record.path : undefined,
        typeof record.startLine === "number" ? String(record.startLine) : undefined,
        typeof record.message === "string" ? record.message : undefined,
      ]
        .filter(Boolean)
        .join(":");
    })
    .filter(Boolean)
    .join("; ") || undefined;
}

function summarizeMatches(values: unknown[]): string | undefined {
  return values
    .slice(0, 6)
    .map((value) => {
      if (!value || typeof value !== "object") {
        return "";
      }
      const record = value as Record<string, unknown>;
      return [
        typeof record.path === "string" ? record.path : undefined,
        typeof record.line === "number" ? String(record.line) : undefined,
        typeof record.text === "string" ? record.text : undefined,
      ]
        .filter(Boolean)
        .join(":");
    })
    .filter(Boolean)
    .join("; ") || undefined;
}

function summarizeEntries(values: unknown[]): string | undefined {
  const names = values
    .slice(0, 12)
    .map((value) => {
      if (!value || typeof value !== "object") {
        return "";
      }
      const record = value as Record<string, unknown>;
      return typeof record.name === "string" ? record.name : "";
    })
    .filter(Boolean);
  return names.length > 0 ? `entries: ${names.join(", ")}` : undefined;
}

function summarizeFiles(values: unknown[]): string | undefined {
  return values
    .slice(0, 4)
    .map((value) => {
      if (!value || typeof value !== "object") {
        return "";
      }
      const record = value as Record<string, unknown>;
      const path = typeof record.path === "string" ? record.path : undefined;
      const content =
        typeof record.content === "string"
          ? record.content.replace(/\s+/g, " ").trim().slice(0, 100)
          : undefined;
      return [path, content].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("; ") || undefined;
}
