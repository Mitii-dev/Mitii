import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";

const DEFAULT_RECENT_TOOL_MESSAGES_TO_KEEP_FULL = 3;
const DEFAULT_COMPACTED_TOOL_RESULT_CHARS_RATIO = 0.006;
const DEFAULT_COMPACTED_TOOL_ARGUMENT_CHARS_RATIO = 0.003;
const DEFAULT_DROPPED_TURN_SUMMARY_CHARS_RATIO = 0.01;
const DEFAULT_ESTABLISHED_FACT_REINJECT_CHARS_RATIO = 0.012;
const DEFAULT_MEMORY_REINJECT_CHARS_RATIO = 0.006;
const DEFAULT_MIN_MESSAGES_TO_KEEP = 6;
const DEFAULT_WARN_RATIO = 0.7;
const DEFAULT_AUTO_RATIO = 0.8;
const DEFAULT_HARD_RATIO = 0.92;

export type ModelLoopCompactionPressure = "within" | "warn" | "auto" | "hard";

export interface ModelLoopCompactionThresholds {
  warnTokens: number;
  autoTokens: number;
  hardTokens: number;
}

export interface ModelLoopCompactionResult {
  messages: ModelMessage[];
  usedTokens: number;
  omittedTokens: number;
  truncatedTokens: number;
  compacted: boolean;
  pressure: ModelLoopCompactionPressure;
  thresholds: ModelLoopCompactionThresholds;
  summarizedDroppedTurns: boolean;
  reinjectedMemory: boolean;
  reinjectedEstablishedFacts: boolean;
}

export function compactModelLoopMessages(params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  budgetTokens: number;
  recentToolMessagesToKeepFull?: number;
  compactedToolResultChars?: number;
  compactedToolArgumentChars?: number;
  droppedTurnSummaryChars?: number;
  minMessagesToKeep?: number;
  warnRatio?: number;
  autoRatio?: number;
  hardRatio?: number;
  /** Budgeted memory facts to reinject after auto/hard compaction. */
  memoryFacts?: readonly { id: string; content: string }[];
  maxMemoryReinjectChars?: number;
  /** Mid-run observations that must survive dropped turns. */
  establishedFacts?: readonly { id: string; content: string }[];
  maxEstablishedFactReinjectChars?: number;
}): ModelLoopCompactionResult {
  const recentToolMessagesToKeepFull =
    params.recentToolMessagesToKeepFull ??
    DEFAULT_RECENT_TOOL_MESSAGES_TO_KEEP_FULL;
  const compactedToolResultChars =
    params.compactedToolResultChars ??
    scaledChars(params.budgetTokens, DEFAULT_COMPACTED_TOOL_RESULT_CHARS_RATIO);
  const compactedToolArgumentChars =
    params.compactedToolArgumentChars ??
    scaledChars(params.budgetTokens, DEFAULT_COMPACTED_TOOL_ARGUMENT_CHARS_RATIO);
  const droppedTurnSummaryChars =
    params.droppedTurnSummaryChars ??
    scaledChars(params.budgetTokens, DEFAULT_DROPPED_TURN_SUMMARY_CHARS_RATIO);
  const maxEstablishedFactReinjectChars =
    params.maxEstablishedFactReinjectChars ??
    scaledChars(params.budgetTokens, DEFAULT_ESTABLISHED_FACT_REINJECT_CHARS_RATIO);
  const maxMemoryReinjectChars =
    params.maxMemoryReinjectChars ??
    scaledChars(params.budgetTokens, DEFAULT_MEMORY_REINJECT_CHARS_RATIO);
  const minMessagesToKeep =
    params.minMessagesToKeep ?? DEFAULT_MIN_MESSAGES_TO_KEEP;
  const thresholds = resolveCompactionThresholds({
    budgetTokens: params.budgetTokens,
    warnRatio: params.warnRatio ?? DEFAULT_WARN_RATIO,
    autoRatio: params.autoRatio ?? DEFAULT_AUTO_RATIO,
    hardRatio: params.hardRatio ?? DEFAULT_HARD_RATIO,
  });

  let working = params.messages.map(cloneMessage);
  let compacted = false;
  let truncatedTokens = 0;
  let summarizedDroppedTurns = false;
  let reinjectedMemory = false;
  let reinjectedEstablishedFacts = false;
  const droppedForSummary: ModelMessage[] = [];

  const estimateAll = (messages: readonly ModelMessage[]): number =>
    estimateModelMessagesTokens(messages, params.estimator);

  let usedTokens = estimateAll(working);
  const initialPressure = resolveCompactionPressure({
    usedTokens,
    thresholds,
  });
  if (usedTokens < thresholds.autoTokens) {
    return {
      messages: working,
      usedTokens,
      omittedTokens: 0,
      truncatedTokens: 0,
      compacted: false,
      pressure: initialPressure,
      thresholds,
      summarizedDroppedTurns: false,
      reinjectedMemory: false,
      reinjectedEstablishedFacts: false,
    };
  }

  const toolCallMessageIndices = working
    .map((message, index) =>
      message.toolCalls && message.toolCalls.length > 0 ? index : -1,
    )
    .filter((index) => index >= 0);
  const fullToolCallIndices = new Set(
    takeLastIndices(toolCallMessageIndices, recentToolMessagesToKeepFull),
  );

  working = working.map((message, index) => {
    if (!message.toolCalls || fullToolCallIndices.has(index)) {
      return message;
    }

    let messageChanged = false;
    const toolCalls = message.toolCalls.map((toolCall) => {
      if (toolCall.arguments.length <= compactedToolArgumentChars) {
        return toolCall;
      }
      messageChanged = true;
      const compactedArguments = buildCompactedToolArguments(toolCall);
      truncatedTokens += Math.max(
        0,
        params.estimator.estimate(toolCall.arguments) -
          params.estimator.estimate(compactedArguments),
      );
      return {
        ...toolCall,
        arguments: compactedArguments,
      };
    });

    if (!messageChanged) {
      return message;
    }
    compacted = true;
    return { ...message, toolCalls };
  });

  const toolMessageIndices = working
    .map((message, index) => (message.role === "tool" ? index : -1))
    .filter((index) => index >= 0);
  const fullToolMessageIndices = new Set(
    takeLastIndices(toolMessageIndices, recentToolMessagesToKeepFull),
  );
  const toolCallsById = collectToolCallsById(working);

  working = working.map((message, index) => {
    if (
      message.role !== "tool" ||
      fullToolMessageIndices.has(index) ||
      message.content.length <= compactedToolResultChars
    ) {
      return message;
    }

    const nextContent = compactToolMessageContent({
      message,
      toolCall: message.toolCallId
        ? toolCallsById.get(message.toolCallId)
        : undefined,
      maxChars: compactedToolResultChars,
    });
    truncatedTokens += Math.max(
      0,
      params.estimator.estimate(message.content) -
        params.estimator.estimate(nextContent),
    );
    compacted = true;
    return { ...message, content: nextContent };
  });

  usedTokens = estimateAll(working);
  const omittedBeforeDrop = usedTokens;
  while (
    usedTokens > thresholds.autoTokens &&
    countNonSystemMessages(working) > minMessagesToKeep
  ) {
    const dropResult = dropOldestNonSystemTurnWithRemoved(working);
    if (dropResult.messages.length === working.length) {
      break;
    }
    droppedForSummary.push(...dropResult.removed);
    working = dropResult.messages;
    compacted = true;
    usedTokens = estimateAll(working);
  }

  if (droppedForSummary.length > 0) {
    const summary = buildDroppedTurnsSummary(
      droppedForSummary,
      droppedTurnSummaryChars,
    );
    if (summary) {
      working = insertAfterSystemMessages(working, {
        role: "user",
        content: summary,
      });
      summarizedDroppedTurns = true;
      usedTokens = estimateAll(working);
    }
  }

  if (usedTokens > thresholds.hardTokens) {
    const fullyCompacted = compactAllToolPayloads({
      messages: working,
      estimator: params.estimator,
      compactedToolResultChars,
    });
    working = fullyCompacted.messages;
    truncatedTokens += fullyCompacted.truncatedTokens;
    compacted = compacted || fullyCompacted.compacted;
    usedTokens = estimateAll(working);
  }

  if (initialPressure === "auto" || initialPressure === "hard") {
    if (params.establishedFacts && params.establishedFacts.length > 0) {
      const reinjected = reinjectPinnedFacts({
        messages: working,
        facts: params.establishedFacts,
        marker: ESTABLISHED_FACTS_MARKER,
        maxChars: maxEstablishedFactReinjectChars,
        estimator: params.estimator,
        budgetTokens: params.budgetTokens,
      });
      working = reinjected.messages;
      reinjectedEstablishedFacts = reinjected.reinjected;
      usedTokens = estimateAll(working);
    }
    if (params.memoryFacts && params.memoryFacts.length > 0) {
      const reinjected = reinjectPinnedFacts({
        messages: working,
        facts: params.memoryFacts,
        marker: MEMORY_REINJECT_MARKER,
        maxChars: maxMemoryReinjectChars,
        estimator: params.estimator,
        budgetTokens: params.budgetTokens,
      });
      working = reinjected.messages;
      reinjectedMemory = reinjected.reinjected;
      usedTokens = estimateAll(working);
    }
  }

  return {
    messages: working,
    usedTokens,
    omittedTokens: Math.max(0, omittedBeforeDrop - usedTokens),
    truncatedTokens,
    compacted,
    pressure: initialPressure,
    thresholds,
    summarizedDroppedTurns,
    reinjectedMemory,
    reinjectedEstablishedFacts,
  };
}

export function resolveCompactionThresholds(params: {
  budgetTokens: number;
  warnRatio?: number;
  autoRatio?: number;
  hardRatio?: number;
}): ModelLoopCompactionThresholds {
  const budgetTokens = Math.max(1, Math.floor(params.budgetTokens));
  const warnRatio = clampRatio(params.warnRatio ?? DEFAULT_WARN_RATIO);
  const autoRatio = clampRatio(params.autoRatio ?? DEFAULT_AUTO_RATIO);
  const hardRatio = clampRatio(params.hardRatio ?? DEFAULT_HARD_RATIO);
  const sorted = [warnRatio, autoRatio, hardRatio].sort((a, b) => a - b);

  return {
    warnTokens: Math.max(1, Math.floor(budgetTokens * sorted[0]!)),
    autoTokens: Math.max(1, Math.floor(budgetTokens * sorted[1]!)),
    hardTokens: Math.max(1, Math.floor(budgetTokens * sorted[2]!)),
  };
}

export function resolveCompactionPressure(params: {
  usedTokens: number;
  thresholds: ModelLoopCompactionThresholds;
}): ModelLoopCompactionPressure {
  if (params.usedTokens >= params.thresholds.hardTokens) {
    return "hard";
  }
  if (params.usedTokens >= params.thresholds.autoTokens) {
    return "auto";
  }
  if (params.usedTokens >= params.thresholds.warnTokens) {
    return "warn";
  }
  return "within";
}

export function estimateModelMessagesTokens(
  messages: readonly ModelMessage[],
  estimator: TokenEstimatorPort,
): number {
  return messages.reduce(
    (sum, message) => sum + estimateModelMessageTokens(message, estimator),
    0,
  );
}

export function estimateModelMessageTokens(
  message: ModelMessage,
  estimator: TokenEstimatorPort,
): number {
  let tokens = estimator.estimate(message.content);
  if (message.name) {
    tokens += estimator.estimate(message.name);
  }
  if (message.toolCallId) {
    tokens += estimator.estimate(message.toolCallId);
  }
  for (const toolCall of message.toolCalls ?? []) {
    tokens += estimator.estimate(toolCall.id);
    tokens += estimator.estimate(toolCall.name);
    tokens += estimator.estimate(toolCall.arguments);
    tokens += 8;
  }
  for (const attachment of message.attachments ?? []) {
    tokens += estimator.estimate(attachment.mimeType);
    tokens += estimator.estimate(attachment.name ?? "");
    tokens += estimator.estimate(attachment.data);
  }
  return tokens + 4;
}

function cloneMessage(message: ModelMessage): ModelMessage {
  return {
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
  };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AUTO_RATIO;
  }
  return Math.min(1, Math.max(0.01, value));
}

function scaledChars(budgetTokens: number, ratio: number): number {
  return Math.max(1, Math.floor(Math.max(1, budgetTokens) * ratio));
}

function buildCompactedToolArguments(toolCall: ModelToolCall): string {
  const schemaSafe = buildSchemaSafeCompactedToolArguments(toolCall);
  if (schemaSafe) {
    return schemaSafe;
  }

  return JSON.stringify({
    compacted: true,
    reason: "previous_completed_tool_call_arguments_omitted",
    originalArgumentCharacters: toolCall.arguments.length,
  });
}

function buildSchemaSafeCompactedToolArguments(
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
    default:
      return undefined;
  }
}

function compactReadManyFilesArguments(
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

function compactObject(
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

function parseJsonObject(value: string): Record<string, unknown> | undefined {
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

function countNonSystemMessages(messages: readonly ModelMessage[]): number {
  return messages.filter((message) => message.role !== "system").length;
}

function takeLastIndices(indices: readonly number[], count: number): number[] {
  if (count <= 0) {
    return [];
  }
  return indices.slice(-count);
}

function dropOldestNonSystemTurnWithRemoved(
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

function collectToolCallsById(
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

function compactToolMessageContent(params: {
  message: ModelMessage;
  toolCall?: ModelToolCall;
  maxChars: number;
}): string {
  const parsed = parseJsonObject(params.message.content);
  const args = params.toolCall
    ? parseJsonObject(params.toolCall.arguments)
    : undefined;
  const output = parsed?.output ?? parsed?.outputPreview;
  const compact: Record<string, unknown> = {
    compacted: true,
    reason: "previous_tool_result_compacted",
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

function buildDroppedTurnsSummary(
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

function summarizeToolCalls(toolCalls: readonly ModelToolCall[]): string | undefined {
  const summaries = toolCalls
    .map((toolCall) => {
      const args = parseJsonObject(toolCall.arguments);
      const locator = args ? resolveToolArgumentLocator(toolCall.name, args) : undefined;
      return locator ? `${toolCall.name}(${locator})` : toolCall.name;
    })
    .filter(Boolean);
  return summaries.length > 0 ? `tools=${summaries.join(", ")}` : undefined;
}

function summarizeDroppedToolTurn(
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

function insertAfterSystemMessages(
  messages: readonly ModelMessage[],
  insert: ModelMessage,
): ModelMessage[] {
  let insertAt = 0;
  while (insertAt < messages.length && messages[insertAt]?.role === "system") {
    insertAt += 1;
  }
  return [
    ...messages.slice(0, insertAt),
    insert,
    ...messages.slice(insertAt),
  ];
}

const MEMORY_REINJECT_MARKER = "[memory reinjected after compaction]";
const ESTABLISHED_FACTS_MARKER =
  "[established observations after compaction]";

function reinjectPinnedFacts(params: {
  messages: ModelMessage[];
  facts: readonly { id: string; content: string }[];
  marker: string;
  maxChars: number;
  estimator: TokenEstimatorPort;
  budgetTokens: number;
}): { messages: ModelMessage[]; reinjected: boolean } {
  if (params.messages.some((message) => message.content.includes(params.marker))) {
    return { messages: params.messages, reinjected: false };
  }

  const lines: string[] = [params.marker];
  let chars = params.marker.length;
  for (const fact of params.facts) {
    const line = `- (${fact.id}) ${fact.content.replace(/\s+/g, " ").trim()}`;
    if (chars + line.length + 1 > params.maxChars) {
      break;
    }
    lines.push(line);
    chars += line.length + 1;
  }
  if (lines.length <= 1) {
    return { messages: params.messages, reinjected: false };
  }

  const next = insertAfterSystemMessages(params.messages, {
    role: "user",
    content: lines.join("\n"),
  });
  const used = estimateModelMessagesTokens(next, params.estimator);
  if (used > params.budgetTokens) {
    return { messages: params.messages, reinjected: false };
  }
  return { messages: next, reinjected: true };
}

function compactAllToolPayloads(params: {
  messages: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  compactedToolResultChars: number;
}): {
  messages: ModelMessage[];
  truncatedTokens: number;
  compacted: boolean;
} {
  let compacted = false;
  let truncatedTokens = 0;
  const toolCallsById = collectToolCallsById(params.messages);
  const messages = params.messages.map((message) => {
    let next = message;

    if (message.toolCalls && message.toolCalls.length > 0) {
      const toolCalls = message.toolCalls.map((toolCall) => {
        const compactedArguments = buildCompactedToolArguments(toolCall);
        if (toolCall.arguments === compactedArguments) {
          return toolCall;
        }
        compacted = true;
        truncatedTokens += Math.max(
          0,
          params.estimator.estimate(toolCall.arguments) -
            params.estimator.estimate(compactedArguments),
        );
        return { ...toolCall, arguments: compactedArguments };
      });
      next = { ...next, toolCalls };
    }

    if (
      next.role === "tool" &&
      next.content.length > params.compactedToolResultChars
    ) {
      const content = compactToolMessageContent({
        message: next,
        toolCall: next.toolCallId
          ? toolCallsById.get(next.toolCallId)
          : undefined,
        maxChars: params.compactedToolResultChars,
      });
      compacted = true;
      truncatedTokens += Math.max(
        0,
        params.estimator.estimate(next.content) -
          params.estimator.estimate(content),
      );
      next = { ...next, content };
    }

    return next;
  });

  return { messages, truncatedTokens, compacted };
}
