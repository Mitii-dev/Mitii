import { AGENT_ENGINE_THRESHOLDS } from "../policy";

const OBSERVATION_TOOLS = new Set([
  "read_file",
  "read_many_files",
  "search_files",
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
 * mid-run facts that must survive hard compaction.
 */
export function extractEstablishedFact(params: {
  toolName: string;
  argumentsValue: unknown;
  output?: unknown;
  outputPreview?: string;
}): EstablishedFact | undefined {
  if (!OBSERVATION_TOOLS.has(params.toolName)) {
    return undefined;
  }

  const locator = resolveLocator(params.toolName, params.argumentsValue);
  const preview = resolvePreview(params.output, params.outputPreview);
  if (!locator || !preview) {
    return undefined;
  }

  const clipped = preview
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, AGENT_ENGINE_THRESHOLDS.establishedFactChars);
  if (clipped.length < 8) {
    return undefined;
  }

  return {
    id: `${params.toolName}:${locator}`,
    content: `${locator}: ${clipped}`,
  };
}

export function upsertEstablishedFact(
  facts: EstablishedFact[],
  next: EstablishedFact | undefined,
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
  if (facts.length > AGENT_ENGINE_THRESHOLDS.maxEstablishedFacts) {
    facts.splice(0, facts.length - AGENT_ENGINE_THRESHOLDS.maxEstablishedFacts);
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

function resolveLocator(toolName: string, argumentsValue: unknown): string | undefined {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return toolName;
  }
  const record = argumentsValue as Record<string, unknown>;
  if (typeof record.path === "string" && record.path.trim().length > 0) {
    return record.path.trim();
  }
  if (Array.isArray(record.paths) && record.paths.length > 0) {
    return record.paths
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      .slice(0, 4)
      .join(",");
  }
  if (typeof record.query === "string" && record.query.trim().length > 0) {
    return record.query.trim().slice(0, 80);
  }
  if (typeof record.symbol === "string" && record.symbol.trim().length > 0) {
    return record.symbol.trim();
  }
  return toolName;
}

function resolvePreview(output: unknown, outputPreview?: string): string | undefined {
  if (typeof output === "string" && output.trim().length > 0) {
    return output;
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
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
