import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { createLogger } from './Logger';

const log = createLogger('AsyncDebugTrace');
const SECRET_KEY = /(authorization|api[-_]?key|token|secret|password|cookie)/i;
const SECRET_VALUE_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /api[_-]?key["\s:=]+["']?[a-zA-Z0-9._-]{8,}/gi,
  /token["\s:=]+["']?[a-zA-Z0-9._-]{8,}/gi,
  /password["\s:=]+["']?[^\s"']{4,}/gi,
];
const MAX_QUEUE_ENTRIES = 10_000;
const MAX_FLUSH_BATCH = 250;
const FLUSH_DELAY_MS = 25;

export type DebugTraceChannel = 'llm' | 'mcp' | 'webview' | 'daemon' | 'webhook';

export interface DebugTraceConfig {
  enabled: boolean;
  includePayloads: boolean;
  llm: boolean;
  mcp: boolean;
  webview: boolean;
  daemon: boolean;
  webhook: boolean;
  maxPayloadChars: number;
}

interface QueuedEntry {
  path: string;
  entry: Record<string, unknown>;
  maxPayloadChars: number;
}

const DEFAULT_CONFIG: DebugTraceConfig = {
  enabled: false,
  includePayloads: false,
  llm: true,
  mcp: true,
  webview: true,
  daemon: true,
  webhook: true,
  maxPayloadChars: 16_000,
};

/**
 * Low-overhead opt-in trace sink. Hot paths only sanitize/serialize and enqueue;
 * filesystem writes are batched outside the caller's request/stream stack.
 */
export class AsyncDebugTrace {
  private config: DebugTraceConfig = { ...DEFAULT_CONFIG };
  private sessionId = '';
  private tracePath = '';
  private queue: QueuedEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private dropped = 0;

  configure(workspace: string, sessionId: string, config?: Partial<DebugTraceConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = sessionId;
    this.tracePath = workspace && sessionId
      ? join(workspace, '.mitii', 'logs', `${sessionId}.trace.jsonl`)
      : '';
  }

  isEnabled(channel?: DebugTraceChannel): boolean {
    if (!this.config.enabled || !this.tracePath) return false;
    return channel ? this.config[channel] : true;
  }

  includesPayloads(): boolean {
    return this.config.includePayloads;
  }

  trace(
    channel: DebugTraceChannel,
    event: string,
    data?: Record<string, unknown>,
    payload?: unknown
  ): void {
    if (!this.isEnabled(channel)) return;

    const entry: Record<string, unknown> = {
      ts: Date.now(),
      sessionId: this.sessionId,
      channel,
      event,
      data,
    };
    if (this.config.includePayloads && payload !== undefined) {
      entry.payload = payload;
    }

    if (this.queue.length >= MAX_QUEUE_ENTRIES) {
      this.dropped += 1;
      return;
    }
    this.queue.push({
      path: this.tracePath,
      entry,
      maxPayloadChars: this.config.maxPayloadChars,
    });
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.flushing) {
      await this.flushing;
    }
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, MAX_FLUSH_BATCH);
    const dropped = this.dropped;
    this.dropped = 0;
    this.flushing = this.writeBatch(batch, dropped);
    try {
      await this.flushing;
    } finally {
      this.flushing = undefined;
      if (this.queue.length > 0) this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.flushing) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  private async writeBatch(batch: QueuedEntry[], dropped: number): Promise<void> {
    const byPath = new Map<string, string[]>();
    for (const item of batch) {
      const lines = byPath.get(item.path) ?? [];
      const sanitized = sanitizeTraceEntry(item.entry, item.maxPayloadChars);
      lines.push(`${JSON.stringify(sanitized)}\n`);
      byPath.set(item.path, lines);
    }

    try {
      for (const [path, lines] of byPath) {
        if (dropped > 0) {
          lines.push(`${JSON.stringify({
            ts: Date.now(),
            sessionId: this.sessionId,
            channel: 'trace',
            event: 'entries_dropped',
            data: { count: dropped },
          })}\n`);
        }
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, lines.join(''), 'utf8');
      }
    } catch (error) {
      log.warn('Failed to flush debug trace', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function sanitizeTraceEntry(entry: Record<string, unknown>, maxPayloadChars: number): Record<string, unknown> {
  return {
    ...entry,
    data: sanitizeValue(entry.data),
    ...(entry.payload === undefined
      ? {}
      : { payload: sanitizeValue(entry.payload, maxPayloadChars) }),
  };
}

function sanitizeValue(value: unknown, maxStringChars = 8_000, depth = 0): unknown {
  if (depth > 8) return '[MAX_DEPTH]';
  if (typeof value === 'string') {
    let sanitized = value;
    for (const pattern of SECRET_VALUE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized.length > maxStringChars
      ? `${sanitized.slice(0, maxStringChars)}…[TRUNCATED ${sanitized.length - maxStringChars} chars]`
      : sanitized;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, maxStringChars, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY.test(key)
        ? '[REDACTED]'
        : sanitizeValue(nested, maxStringChars, depth + 1);
    }
    return output;
  }
  return value;
}

export const debugTrace = new AsyncDebugTrace();
