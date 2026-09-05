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
    case "find_references":
      return compactObject(parsed, ["path", "line", "column"], ["path", "line"]);
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

export function compactToolMessageContent(params: {
  message: ModelMessage;
  toolCall?: ModelToolCall;
  maxChars: number;
  reason?: string;
}): string {
  const parsed = parseJsonObject(params.message.content);
  const args = params.toolCall
    ? parseJsonObject(params.toolCall.arguments)
    : undefined;
  const output = parsed?.output ?? parsed?.outputPreview;
  const compact: Record<string, unknown> = {
    compacted: true,
    reason: params.reason ?? "previous_tool_result_compacted",
    ...(parsed?.status ? { status: parsed.status } : {}),
    toolName:
      typeof parsed?.toolName === "string"
        ? parsed.toolName
        : params.toolCall?.name,
    ...(parsed?.reasonCode ? { reasonCode: parsed.reasonCode } : {}),
    ...(parsed?.truncated ? { truncated: parsed.truncated } : {}),
    ...(parsed?.redacted ? { redacted: parsed.redacted } : {}),
  };

  const locator = params.toolCall && args
    ? resolveToolArgumentLocator(params.toolCall.name, args)
    : undefined;
  if (locator) {
    compact.locator = locator;
  }

  const finding = summarizeToolOutput(output ?? params.message.content);
  if (finding) {
    compact.finding = clipToBudget(finding, params.maxChars);
  }

  const serialized = JSON.stringify(compact);
  if (serialized.length <= params.maxChars) {
    return serialized;
  }
  return JSON.stringify({
    ...compact,
    finding:
      typeof compact.finding === "string"
        ? clipToBudget(compact.finding, Math.max(24, params.maxChars - 220))
        : undefined,
  });
}

export function buildDroppedTurnsSummary(
  dropped: readonly ModelMessage[],
  maxChars: number,
): string | undefined {
  if (dropped.length === 0) {
    return undefined;
  }
  const lines: string[] = [
    "[compacted prior context — older turns summarized locally]",
  ];
  let chars = lines[0]!.length;
  const toolCallsById = new Map<string, ModelToolCall>();
  for (const message of dropped) {
    for (const toolCall of message.toolCalls ?? []) {
      toolCallsById.set(toolCall.id, toolCall);
    }
  }

  for (const message of dropped) {
    if (message.role === "tool") {
      const line = summarizeDroppedToolTurn(message, toolCallsById);
      if (!line) {
        continue;
      }
      if (chars + line.length + 1 > maxChars) {
        lines.push("- …");
        break;
      }
      lines.push(line);
      chars += line.length + 1;
      continue;
    }
    const preview = compactPreview(
      message.content,
      Math.max(80, Math.floor(maxChars / 6)),
    );
    const toolSummary = summarizeToolCalls(message.toolCalls ?? []);
    const lineBody = [preview, toolSummary].filter(Boolean).join(" ");
    if (!lineBody) {
      continue;
    }
    const line = `- ${message.role}: ${lineBody}`;
    if (chars + line.length + 1 > maxChars) {
      lines.push("- …");
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }
  return lines.length > 1 ? lines.join("\n") : undefined;
}

export function summarizeToolCalls(toolCalls: readonly ModelToolCall[]): string | undefined {
  const summaries = toolCalls
    .map((toolCall) => {
      const args = parseJsonObject(toolCall.arguments);
      const locator = args ? resolveToolArgumentLocator(toolCall.name, args) : undefined;
      return locator ? `${toolCall.name}(${locator})` : toolCall.name;
    })
    .filter(Boolean);
  return summaries.length > 0 ? `tools=${summaries.join(", ")}` : undefined;
}

export function summarizeDroppedToolTurn(
  message: ModelMessage,
  toolCallsById: ReadonlyMap<string, ModelToolCall>,
): string | undefined {
  if (!message.toolCallId) {
    return undefined;
  }
  const toolCall = toolCallsById.get(message.toolCallId);
  const toolName = toolCall?.name ?? "tool";
  const args = toolCall ? parseJsonObject(toolCall.arguments) : undefined;
  const locator = args ? resolveToolArgumentLocator(toolName, args) : undefined;
  const parsedContent = parseJsonObject(message.content);
  const resultOutput = parsedContent?.output ?? parsedContent?.outputPreview;
  const finding = summarizeToolOutput(resultOutput ?? message.content);
  const label = locator ? `${toolName} ${locator}` : toolName;
  return `- tool: ${label}${finding ? ` => ${finding}` : ""}`;
}

function resolveToolArgumentLocator(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
  if (path) {
    const startLine = typeof args.startLine === "number" ? args.startLine : undefined;
    const endLine = typeof args.endLine === "number" ? args.endLine : undefined;
    const range =
      startLine || endLine
        ? `:${startLine ?? 1}${endLine ? `-${endLine}` : ""}`
        : "";
    return `${path}${range}`;
  }
  if (Array.isArray(args.paths)) {
    const paths = args.paths
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 4);
    if (paths.length > 0) {
      return paths.join(",");
    }
  }
  if (query) {
    return `query="${query.slice(0, 80)}"`;
  }
  if (pattern) {
    return `pattern="${pattern.slice(0, 80)}"`;
  }
  return toolName;
}

function summarizeToolOutput(output: unknown): string | undefined {
  if (typeof output === "string") {
    return compactPreview(output);
  }
  if (!output || typeof output !== "object") {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  if (typeof record.content === "string") {
    return compactPreview(record.content);
  }
  if (typeof record.text === "string") {
    return compactPreview(record.text);
  }
  if (Array.isArray(record.matches)) {
    return compactPreview(
      record.matches
        .slice(0, 4)
        .map((match) => {
          if (!match || typeof match !== "object") {
            return "";
          }
          const item = match as Record<string, unknown>;
          return [
            typeof item.path === "string" ? item.path : undefined,
            typeof item.line === "number" ? String(item.line) : undefined,
            typeof item.text === "string" ? item.text : undefined,
          ]
            .filter(Boolean)
            .join(":");
        })
        .filter(Boolean)
        .join("; "),
    );
  }
  if (Array.isArray(record.files)) {
    return compactPreview(
      record.files
        .slice(0, 4)
        .map((file) => {
          if (!file || typeof file !== "object") {
            return "";
          }
          const item = file as Record<string, unknown>;
          return [
            typeof item.path === "string" ? item.path : undefined,
            typeof item.content === "string" ? compactPreview(item.content, 80) : undefined,
          ]
            .filter(Boolean)
            .join(": ");
        })
        .filter(Boolean)
        .join("; "),
    );
  }
  return compactPreview(JSON.stringify(record));
}

function compactPreview(value: string, maxChars = 180): string | undefined {
  const preview = value.replace(/\s+/g, " ").trim();
  if (!preview) {
    return undefined;
  }
  return preview.length > maxChars ? `${preview.slice(0, maxChars)}…` : preview;
}

function clipToBudget(value: string, maxChars: number): string {
  const limit = Math.max(1, maxChars);
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

