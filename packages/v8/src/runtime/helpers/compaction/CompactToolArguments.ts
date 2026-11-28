import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

/** Identical old/new so a copied compacted patch cannot apply as a real edit. */
export const COMPACTED_PATCH_PLACEHOLDER = "[compacted prior patch]";

export function buildCompactedToolArguments(toolCall: ModelToolCall): string {
  const schemaSafe = buildSchemaSafeCompactedToolArguments(toolCall);
  if (schemaSafe) {
    return schemaSafe;
  }

  if (toolCall.name === "apply_patch") {
    return JSON.stringify({
      patches: [
        {
          path: "(compacted prior patch)",
          oldText: COMPACTED_PATCH_PLACEHOLDER,
          newText: COMPACTED_PATCH_PLACEHOLDER,
        },
      ],
    });
  }

  // Never emit unrecognized keys. Models copy compacted history as the next call.
  return "{}";
}

export function buildSchemaSafeCompactedToolArguments(
  toolCall: ModelToolCall,
): string | undefined {
  const parsed = parseJsonObject(toolCall.arguments);
  if (!parsed) {
    return undefined;
  }

  switch (toolCall.name) {
    case "read_file":
      return compactObject(parsed, ["path", "startLine", "endLine"], ["path"]);
    case "read_many_files":
      return compactReadManyFilesArguments(parsed);
    case "list_directory":
    case "file_metadata":
    case "read_package_scripts":
      return compactObject(parsed, ["path"], ["path"]);
    case "search_files":
      return compactObject(
        parsed,
        ["query", "path", "maxMatches", "caseSensitive"],
        ["query"],
      );
    case "glob_files":
      return compactObject(
        parsed,
        ["pattern", "path", "maxResults"],
        ["pattern"],
      );
    case "read_diagnostics":
      return compactObject(parsed, ["paths"], []);
    case "goto_definition":
    case "find_type_definition":
    case "find_references":
    case "hover_symbol":
    case "find_implementation":
    case "call_hierarchy":
      return compactObject(parsed, ["path", "line", "column", "direction"], ["path", "line"]);
    case "document_symbol":
      return compactObject(parsed, ["path"], ["path"]);
    case "workspace_symbol":
      return compactObject(parsed, ["query"], ["query"]);
    case "analyze_change_impact":
      return compactObject(
        parsed,
        ["path", "symbolName", "maximumHops"],
        ["path"],
      );
    case "apply_patch":
      return compactApplyPatchArguments(parsed);
    case "delete_file":
    case "delete_directory":
      return compactObject(parsed, ["path", "recursive"], ["path"]);
    case "move_file":
      return compactObject(parsed, ["from", "to"], ["from", "to"]);
    default:
      return undefined;
  }
}

export function compactApplyPatchArguments(
  parsed: Record<string, unknown>,
): string | undefined {
  const rawPatches = Array.isArray(parsed.patches)
    ? parsed.patches
    : typeof parsed.path === "string" && parsed.path.trim().length > 0
      ? [parsed]
      : [];
  if (rawPatches.length === 0) {
    return undefined;
  }

  const patches: Array<{
    path: string;
    oldText: string;
    newText: string;
  }> = [];
  for (const raw of rawPatches) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const path = (raw as Record<string, unknown>).path;
    if (typeof path !== "string" || path.trim().length === 0) {
      return undefined;
    }
    patches.push({
      path,
      oldText: COMPACTED_PATCH_PLACEHOLDER,
      newText: COMPACTED_PATCH_PLACEHOLDER,
    });
  }
  return JSON.stringify({ patches });
}

export function compactReadManyFilesArguments(
  parsed: Record<string, unknown>,
): string | undefined {
  const paths = parsed.paths;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !paths.every((path) => typeof path === "string" && path.trim().length > 0)
  ) {
    return undefined;
  }

  const next: Record<string, unknown> = { paths };
  if (
    typeof parsed.maxBytesPerFile === "number" &&
    Number.isSafeInteger(parsed.maxBytesPerFile) &&
    parsed.maxBytesPerFile > 0
  ) {
    next.maxBytesPerFile = parsed.maxBytesPerFile;
  }
  return JSON.stringify(next);
}

export function compactObject(
  parsed: Record<string, unknown>,
  keepKeys: readonly string[],
  requiredKeys: readonly string[],
): string | undefined {
  for (const key of requiredKeys) {
    const value = parsed[key];
    if (
      !(
        typeof value === "string"
          ? value.trim().length > 0
          : typeof value === "number"
            ? Number.isSafeInteger(value) && value > 0
            : value !== undefined
      )
    ) {
      return undefined;
    }
  }

  const next: Record<string, unknown> = {};
  for (const key of keepKeys) {
    const value = parsed[key];
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return JSON.stringify(next);
}

export function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function countNonSystemMessages(messages: readonly ModelMessage[]): number {
  return messages.filter((message) => message.role !== "system").length;
}

export function takeLastIndices(indices: readonly number[], count: number): number[] {
  if (count <= 0) {
    return [];
  }
  return indices.slice(-count);
}

export function dropOldestNonSystemTurnWithRemoved(
  messages: readonly ModelMessage[],
): { messages: ModelMessage[]; removed: ModelMessage[] } {
  const index = messages.findIndex((message) => message.role !== "system");
  if (index < 0) {
    return { messages: [...messages], removed: [] };
  }

  const removed: ModelMessage[] = [];
  const head = messages[index]!;
  removed.push(head);
  const removedToolCallIds = new Set(
    (head.toolCalls ?? []).map((toolCall) => toolCall.id),
  );

  const next = [...messages.slice(0, index), ...messages.slice(index + 1)];
  while (
    removedToolCallIds.size > 0 &&
    next[index]?.role === "tool" &&
    next[index]?.toolCallId &&
    removedToolCallIds.has(next[index]!.toolCallId)
  ) {
    removed.push(next[index]!);
    next.splice(index, 1);
  }

  while (true) {
    const firstNonSystem = next.findIndex(
      (message) => message.role !== "system",
    );
    if (firstNonSystem < 0 || next[firstNonSystem]?.role !== "tool") {
      break;
    }
    removed.push(next[firstNonSystem]!);
    next.splice(firstNonSystem, 1);
  }

  return { messages: next, removed };
}

export function collectToolCallsById(
  messages: readonly ModelMessage[],
): Map<string, ModelToolCall> {
  const toolCalls = new Map<string, ModelToolCall>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      toolCalls.set(toolCall.id, toolCall);
    }
  }
  return toolCalls;
}

