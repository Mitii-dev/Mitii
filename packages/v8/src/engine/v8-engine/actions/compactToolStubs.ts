import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import {
  collectToolCallsById,
  compactToolMessageContent,
  parseJsonObject,
} from "./compactToolHistoryHelpers";

const FILE_BODY_TOOLS = new Set(["read_file", "read_many_files"]);

/**
 * Immediately stub file-read bodies for paths no remaining task still needs.
 * Does not wait for compaction pressure.
 */
export function stubToolResultsForCompletedPaths(params: {
  messages: readonly ModelMessage[];
  paths: readonly string[];
  maxChars: number;
}): { messages: ModelMessage[]; stubbed: boolean } {
  const normalized = params.paths
    .map((path) => path.trim().replace(/\\/g, "/"))
    .filter((path) => path.length > 0);
  if (normalized.length === 0) {
    return { messages: [...params.messages], stubbed: false };
  }

  const toolCallsById = collectToolCallsById(params.messages);
  let stubbed = false;
  const messages = params.messages.map((message) => {
    if (message.role !== "tool") {
      return message;
    }
    const toolCall = message.toolCallId
      ? toolCallsById.get(message.toolCallId)
      : undefined;
    if (!toolCall || !FILE_BODY_TOOLS.has(toolCall.name)) {
      return message;
    }
    const toolPaths = collectToolCallFilePaths(toolCall);
    if (!toolPaths.some((path) => pathMatchesCompleted(path, normalized))) {
      return message;
    }
    const parsed = parseJsonObject(message.content);
    if (
      parsed?.compacted === true &&
      (parsed.reason === "completed_task_file_body_stubbed" ||
        parsed.reason === "previous_tool_result_compacted")
    ) {
      return message;
    }
    if (message.content.length <= params.maxChars) {
      return message;
    }
    stubbed = true;
    return {
      ...message,
      content: compactToolMessageContent({
        message,
        toolCall,
        maxChars: params.maxChars,
        reason: "completed_task_file_body_stubbed",
      }),
    };
  });
  return { messages, stubbed };
}

function collectToolCallFilePaths(toolCall: ModelToolCall): string[] {
  const args = parseJsonObject(toolCall.arguments);
  if (!args) {
    return [];
  }
  if (typeof args.path === "string" && args.path.trim().length > 0) {
    return [args.path.trim().replace(/\\/g, "/")];
  }
  if (Array.isArray(args.paths)) {
    return args.paths
      .filter(
        (path): path is string =>
          typeof path === "string" && path.trim().length > 0,
      )
      .map((path) => path.trim().replace(/\\/g, "/"));
  }
  return [];
}

function pathMatchesCompleted(
  path: string,
  completed: readonly string[],
): boolean {
  return completed.some(
    (candidate) => path === candidate || path.endsWith(`/${candidate}`),
  );
}
