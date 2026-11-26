import type { EstablishedFact } from "./Types";
import { extractCompilerErrorQueue } from "./CompilerErrorQueue";
import { resolveFinding } from "./ObservationSummaries";
import {
  extractFactPaths,
  extractPackageRoleFact,
} from "./PackageRoleFact";

export type { EstablishedFact } from "./Types";

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
  "find_type_definition",
  "find_references",
  "hover_symbol",
  "document_symbol",
  "workspace_symbol",
  "find_implementation",
  "call_hierarchy",
  "file_metadata",
]);

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
      kind: "compiler_queue",
    };
  }

  const packageFact = extractPackageRoleFact(
    params.toolName,
    params.argumentsValue,
    params.output,
    params.outputPreview,
  );
  if (packageFact) {
    return packageFact;
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

  const paths = extractFactPaths(params.toolName, params.argumentsValue, locator);
  return {
    id: `${params.toolName}:${locator}`,
    content: `${locator} => ${clipped}`,
    kind: "observation",
    ...(paths.length > 0 ? { paths } : {}),
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

