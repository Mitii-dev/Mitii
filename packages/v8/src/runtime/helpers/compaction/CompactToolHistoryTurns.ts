import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import { parseJsonObject } from "./CompactToolArguments";

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
  if (
    Array.isArray(record.affectedFiles) ||
    (Array.isArray(record.affected) && record.provider === "repo_graph")
  ) {
    const files = Array.isArray(record.affectedFiles)
      ? record.affectedFiles
      : [];
    const filePreview = files
      .slice(0, 6)
      .map((file) => {
        if (!file || typeof file !== "object") {
          return "";
        }
        const item = file as Record<string, unknown>;
        const path = typeof item.path === "string" ? item.path : undefined;
        const hop = typeof item.hop === "number" ? `h${item.hop}` : undefined;
        return [path, hop].filter(Boolean).join("@");
      })
      .filter(Boolean)
      .join(", ");
    const status = typeof record.status === "string" ? record.status : "impact";
    const totals = `files=${files.length} nodes=${
      Array.isArray(record.affected) ? record.affected.length : 0
    }`;
    return compactPreview(
      `${status}; ${totals}${filePreview ? `; ${filePreview}` : ""}`,
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

