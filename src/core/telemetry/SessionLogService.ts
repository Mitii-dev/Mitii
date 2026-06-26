import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from './Logger';

const log = createLogger('SessionLogService');

export type SessionLogEventType =
  | 'session_start'
  | 'session_end'
  | 'user_message'
  | 'assistant_message'
  | 'tool_start'
  | 'tool_end'
  | 'subagent_start'
  | 'subagent_end'
  | 'approval_request'
  | 'approval_decision'
  | 'plan_created'
  | 'plan_step'
  | 'context_pack'
  | 'token_usage'
  | 'error'
  | 'info';

export interface SessionLogEvent {
  ts: number;
  sessionId: string;
  type: SessionLogEventType;
  /** Human-readable summary for quick scanning */
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Append-only JSONL session log for debugging and post-hoc analysis.
 * Files: `<workspace>/.thunder/logs/<sessionId>.jsonl`
 */
export class SessionLogService {
  private enabled = true;
  private workspace = '';
  private sessionId = '';
  private logPath = '';

  configure(workspace: string, sessionId: string, enabled = true): void {
    this.workspace = workspace;
    this.sessionId = sessionId;
    this.enabled = enabled && Boolean(workspace);
    if (!this.enabled) return;

    const dir = join(workspace, '.thunder', 'logs');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.logPath = join(dir, `${sessionId}.jsonl`);
  }

  isEnabled(): boolean {
    return this.enabled && Boolean(this.logPath);
  }

  getLogPath(): string {
    return this.logPath;
  }

  append(type: SessionLogEventType, message: string, data?: Record<string, unknown>): void {
    if (!this.isEnabled()) return;

    const event: SessionLogEvent = {
      ts: Date.now(),
      sessionId: this.sessionId,
      type,
      message,
      data: sanitizeLogData(data),
    };

    try {
      appendFileSync(this.logPath, `${JSON.stringify(event)}\n`, 'utf-8');
    } catch (error) {
      log.warn('Failed to append session log', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Write a session header once at start (idempotent). */
  writeSessionHeader(meta: Record<string, unknown>): void {
    if (!this.isEnabled() || !this.logPath) return;
    if (existsSync(this.logPath) && readFileSync(this.logPath, 'utf-8').trim().length > 0) {
      return;
    }

    const header = {
      _format: 'thunder-session-log',
      version: 1,
      sessionId: this.sessionId,
      workspace: this.workspace,
      startedAt: Date.now(),
      ...meta,
    };

    try {
      writeFileSync(this.logPath, `${JSON.stringify({ ts: Date.now(), sessionId: this.sessionId, type: 'session_start', message: 'Session started', data: header })}\n`, 'utf-8');
    } catch (error) {
      log.warn('Failed to write session log header', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  exportForAnalysis(): string {
    if (!this.logPath || !existsSync(this.logPath)) {
      return '';
    }
    return readFileSync(this.logPath, 'utf-8');
  }

  exportSummary(): string {
    if (!this.logPath || !existsSync(this.logPath)) {
      return 'No session log found.';
    }

    const lines = readFileSync(this.logPath, 'utf-8').trim().split('\n').filter(Boolean);
    const counts: Record<string, number> = {};
    const errors: string[] = [];
    let firstTs = 0;
    let lastTs = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as SessionLogEvent;
        counts[event.type] = (counts[event.type] ?? 0) + 1;
        if (!firstTs || event.ts < firstTs) firstTs = event.ts;
        if (event.ts > lastTs) lastTs = event.ts;
        if (event.type === 'error') {
          errors.push(event.message);
        }
      } catch {
        // skip malformed lines
      }
    }

    const durationSec = firstTs && lastTs ? Math.round((lastTs - firstTs) / 1000) : 0;
    const countLines = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    return [
      `# Thunder session log summary`,
      `session: ${this.sessionId}`,
      `workspace: ${this.workspace}`,
      `log file: ${this.logPath}`,
      `duration: ${durationSec}s`,
      `events: ${lines.length}`,
      '',
      '## Event counts',
      countLines || '  (none)',
      '',
      errors.length > 0 ? `## Errors (${errors.length})\n${errors.map((e) => `- ${e}`).join('\n')}` : '## Errors\n  (none)',
      '',
      '## Full log',
      'Attach the .jsonl file or paste its contents for analysis.',
    ].join('\n');
  }
}

function sanitizeLogData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('key') ||
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('authorization') ||
      lower.includes('apikey')
    ) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (typeof value === 'string' && value.length > 8000) {
      out[key] = `${value.slice(0, 8000)}… [truncated ${value.length - 8000} chars]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}
