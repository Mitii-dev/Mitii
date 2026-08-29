import { appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type {
  LlmPort,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
} from '@mitii/sdk';

import { mitiiLogsDir } from './mitiiWorkspace.js';
import {
  formatMitiiLogStamp,
  MITII_LOG_STAMP_PREFIX,
} from './mitiiLogStamp.js';

type ModelMessage = ModelRequest['messages'][number];
type ModelToolDefinition = NonNullable<ModelRequest['tools']>[number];
type ModelToolCall = NonNullable<ModelMessage['toolCalls']>[number];
type ModelCallContext = {
  runId?: string;
  requestId?: string;
  abortSignal?: AbortSignal;
};
type ModelToolCallDelta = Extract<
  ModelEvent,
  { type: 'tool_call_delta' }
>['toolCalls'][number];
type ModelTokenUsage = NonNullable<
  Extract<ModelEvent, { type: 'usage' }>['usage']
>;

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[a-zA-Z0-9]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /api[_-]?key["\s:=]+["']?[a-zA-Z0-9._-]{8,}/gi,
  /token["\s:=]+["']?[a-zA-Z0-9._-]{8,}/gi,
  /password["\s:=]+["']?[^\s"']{4,}/gi,
];

const MODEL_IO_LIMITS = {
  maxCharsPerMessage: 24_000,
  maxMessagesLogged: 80,
  maxToolDefsLogged: 40,
  maxToolArgChars: 8_000,
  maxContentChars: 48_000,
} as const;

export interface ModelIoSink {
  readonly path: string;
  write(entry: Record<string, unknown>): void;
  close(): void;
}

let activeSink: ModelIoSink | undefined;

export function setActiveModelIoSink(sink: ModelIoSink | undefined): void {
  activeSink = sink;
}

export function getActiveModelIoSink(): ModelIoSink | undefined {
  return activeSink;
}

export function isModelIoLoggingEnabled(
  developerEnabled: boolean,
  modelIoEnabled: boolean,
): boolean {
  return developerEnabled && modelIoEnabled;
}

function redactSecrets(value: string): { text: string; redacted: boolean } {
  let text = value;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    const next = text.replace(pattern, '[REDACTED]');
    if (next !== text) {
      redacted = true;
      text = next;
    }
  }
  return { text, redacted };
}

function compactText(
  value: string,
  maxChars: number,
): { text: string; chars: number; truncated: boolean; redacted: boolean } {
  const redacted = redactSecrets(value);
  if (redacted.text.length <= maxChars) {
    return {
      text: redacted.text,
      chars: redacted.text.length,
      truncated: false,
      redacted: redacted.redacted,
    };
  }
  return {
    text: `${redacted.text.slice(0, maxChars)}…`,
    chars: redacted.text.length,
    truncated: true,
    redacted: redacted.redacted,
  };
}

function sanitizeMessage(message: ModelMessage): Record<string, unknown> {
  const base: Record<string, unknown> = { role: message.role };
  let anyRedacted = false;
  let anyTruncated = false;

  if (typeof message.content === 'string' && message.content.length > 0) {
    const content = compactText(
      message.content,
      MODEL_IO_LIMITS.maxCharsPerMessage,
    );
    base.content = content.text;
    base.contentChars = content.chars;
    anyTruncated = anyTruncated || content.truncated;
    anyRedacted = anyRedacted || content.redacted;
  }

  if (message.toolCallId) {
    base.toolCallId = message.toolCallId;
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    base.toolCalls = message.toolCalls.map((call: ModelToolCall) => {
      const args = compactText(
        call.arguments ?? '',
        MODEL_IO_LIMITS.maxToolArgChars,
      );
      anyTruncated = anyTruncated || args.truncated;
      anyRedacted = anyRedacted || args.redacted;
      return {
        id: call.id,
        name: call.name,
        arguments: args.text,
        argumentChars: args.chars,
        truncated: args.truncated || undefined,
        redacted: args.redacted || undefined,
      };
    });
  }

  if (anyTruncated) base.truncated = true;
  if (anyRedacted) base.redacted = true;
  return base;
}

function sanitizeRequest(request: ModelRequest): Record<string, unknown> {
  const messages = request.messages.slice(0, MODEL_IO_LIMITS.maxMessagesLogged);
  const tools = (request.tools ?? [])
    .slice(0, MODEL_IO_LIMITS.maxToolDefsLogged)
    .map((tool: ModelToolDefinition) => ({
      name: tool.name,
      description: tool.description
        ? compactText(tool.description, 400).text
        : undefined,
    }));

  return {
    model: request.model,
    temperature: request.temperature,
    maximumOutputTokens: request.maximumOutputTokens,
    stream: request.stream,
    toolChoice: request.toolChoice,
    messageCount: request.messages.length,
    messagesTruncated: request.messages.length > messages.length,
    messages: messages.map(sanitizeMessage),
    toolCount: request.tools?.length ?? 0,
    toolsTruncated: (request.tools?.length ?? 0) > tools.length,
    tools,
  };
}

function mergeToolCallDeltas(
  existing: Map<number, { id?: string; name?: string; arguments: string }>,
  deltas: readonly ModelToolCallDelta[],
): void {
  for (const delta of deltas) {
    const current = existing.get(delta.index) ?? {
      id: undefined,
      name: undefined,
      arguments: '',
    };
    if (delta.id) current.id = delta.id;
    if (delta.name) current.name = delta.name;
    if (delta.arguments) current.arguments += delta.arguments;
    existing.set(delta.index, current);
  }
}

/**
 * Decorator that records sanitized model request/response pairs when a sink
 * is active. Auth headers never pass through this layer.
 */
export class LoggingLlmPort implements LlmPort {
  readonly countTokens?: (
    text: string,
    context?: ModelCallContext,
  ) => Promise<number>;

  constructor(
    private readonly inner: LlmPort,
    private readonly getSink: () => ModelIoSink | undefined = getActiveModelIoSink,
  ) {
    if (inner.countTokens) {
      this.countTokens = (text, context) => inner.countTokens!(text, context);
    }
  }

  get id(): string {
    return this.inner.id;
  }

  get capabilities(): ModelCapabilities {
    return this.inner.capabilities;
  }

  async *complete(
    request: ModelRequest,
    context?: ModelCallContext,
  ): AsyncIterable<ModelEvent> {
    const sink = this.getSink();
    const callId = `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();

    if (sink) {
      sink.write({
        kind: 'model_request',
        at: startedAt,
        callId,
        portId: this.inner.id,
        runId: context?.runId,
        requestId: context?.requestId,
        request: sanitizeRequest(request),
      });
    }

    let content = '';
    let reasoning = '';
    const toolCalls = new Map<
      number,
      { id?: string; name?: string; arguments: string }
    >();
    let usage: ModelTokenUsage | undefined;
    let finishReason: string | undefined;
    let error: Record<string, unknown> | undefined;

    try {
      for await (const event of this.inner.complete(request, context)) {
        switch (event.type) {
          case 'content_delta':
            content += event.content;
            break;
          case 'reasoning_delta':
            reasoning += event.reasoning;
            break;
          case 'tool_call_delta':
            mergeToolCallDeltas(toolCalls, event.toolCalls);
            break;
          case 'usage':
            usage = event.usage;
            break;
          case 'completed':
            finishReason = event.finishReason;
            if (event.usage) usage = event.usage;
            break;
          case 'failed':
            finishReason = event.finishReason ?? 'error';
            error = {
              code: event.error.code,
              message: compactText(event.error.message, 1_200).text,
              retryable: event.error.retryable,
              providerCode: event.error.providerCode,
            };
            break;
          case 'cancelled':
            finishReason = 'cancelled';
            error = {
              code: event.error.code,
              message: compactText(event.error.message, 1_200).text,
              retryable: event.error.retryable,
            };
            break;
          default:
            break;
        }
        yield event;
      }
    } finally {
      if (sink) {
        const contentCompact = compactText(
          content,
          MODEL_IO_LIMITS.maxContentChars,
        );
        const reasoningCompact = reasoning
          ? compactText(reasoning, MODEL_IO_LIMITS.maxContentChars)
          : undefined;
        const serializedTools = [...toolCalls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([index, call]) => {
            const args = compactText(
              call.arguments,
              MODEL_IO_LIMITS.maxToolArgChars,
            );
            return {
              index,
              id: call.id,
              name: call.name,
              arguments: args.text,
              argumentChars: args.chars,
              truncated: args.truncated || undefined,
              redacted: args.redacted || undefined,
            };
          });

        sink.write({
          kind: 'model_response',
          at: new Date().toISOString(),
          callId,
          portId: this.inner.id,
          runId: context?.runId,
          requestId: context?.requestId,
          finishReason,
          usage,
          content: contentCompact.text || undefined,
          contentChars: contentCompact.chars,
          contentTruncated: contentCompact.truncated || undefined,
          contentRedacted: contentCompact.redacted || undefined,
          reasoning: reasoningCompact?.text,
          reasoningChars: reasoningCompact?.chars,
          reasoningTruncated: reasoningCompact?.truncated || undefined,
          toolCalls: serializedTools.length > 0 ? serializedTools : undefined,
          error,
        });
      }
    }
  }
}

function safeLogId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'session';
}

function findExistingModelIoFile(dir: string, id: string): string | undefined {
  const suffix = `-${id}-model-io.jsonl`;
  try {
    const names = readdirSync(dir)
      .filter(
        (name) => MITII_LOG_STAMP_PREFIX.test(name) && name.endsWith(suffix),
      )
      .sort();
    return names[0] ? join(dir, names[0]) : undefined;
  } catch {
    return undefined;
  }
}

/** Open/append a per-session model I/O JSONL under `.mitii/logs/`. */
export function openModelIoLog(
  workspaceRoot: string | undefined,
  options: {
    sessionId?: string;
    runId: string;
    at?: string;
  },
): ModelIoSink | undefined {
  if (!workspaceRoot) return undefined;

  const dir = mitiiLogsDir(workspaceRoot);
  mkdirSync(dir, { recursive: true });
  const sessionId = safeLogId(options.sessionId ?? options.runId);
  const file =
    findExistingModelIoFile(dir, sessionId) ??
    join(dir, `${formatMitiiLogStamp()}-${sessionId}-model-io.jsonl`);

  const write = (entry: Record<string, unknown>): void => {
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  };

  write({
    kind: 'model_io_start',
    at: options.at ?? new Date().toISOString(),
    sessionId,
    runId: options.runId,
  });

  let closed = false;
  return {
    path: file,
    write(entry) {
      if (closed) return;
      write(entry);
    },
    close() {
      if (closed) return;
      closed = true;
      write({
        kind: 'model_io_end',
        at: new Date().toISOString(),
        sessionId,
        runId: options.runId,
      });
    },
  };
}

/** Newest `*-model-io.jsonl` under `.mitii/logs/`, if any. */
export function findLatestModelIoLog(
  workspaceRoot: string | undefined,
): string | undefined {
  if (!workspaceRoot) return undefined;
  const dir = mitiiLogsDir(workspaceRoot);
  try {
    const names = readdirSync(dir)
      .filter((name) => name.endsWith('-model-io.jsonl'))
      .sort();
    const last = names[names.length - 1];
    return last ? join(dir, last) : undefined;
  } catch {
    return undefined;
  }
}

export function wrapLlmPortForModelIo(
  port: LlmPort,
  enabled: boolean,
): LlmPort {
  if (!enabled) return port;
  return new LoggingLlmPort(port);
}

/** Test helpers */
export const __testing = {
  sanitizeRequest,
  compactText,
  redactSecrets,
  MODEL_IO_LIMITS,
};
