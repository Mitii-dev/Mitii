import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import { mitiiLogsDir } from './mitiiWorkspace.js';
import { findLatestModelIoLog } from './modelIoLog.js';

const SHAREABLE_LIMITS = {
  promptPreviewChars: 1_200,
  answerPreviewChars: 2_400,
  contentPreviewChars: 1_600,
  maxModelCalls: 12,
  maxTools: 40,
  maxWarnings: 20,
  maxLinesScanned: 4_000,
} as const;

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[a-zA-Z0-9]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /api[_-]?key["\s:=]+["']?[a-zA-Z0-9._-]{8,}/gi,
  /token["\s:=]+["']?[a-zA-Z0-9._-]{8,}/gi,
  /password["\s:=]+["']?[^\s"']{4,}/gi,
];

function redact(value: string): string {
  let text = value;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]');
  }
  return text;
}

function preview(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const text = redact(value).trim();
  if (!text) return undefined;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function readJsonlLines(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const capped = lines.slice(-SHAREABLE_LIMITS.maxLinesScanned);
  const out: Record<string, unknown>[] = [];
  for (const line of capped) {
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip malformed
    }
  }
  return out;
}

function isSessionJsonlName(name: string): boolean {
  return (
    name.endsWith('.jsonl') &&
    !name.endsWith('-model-io.jsonl') &&
    !name.includes('shareable')
  );
}

/** Newest normal session JSONL (excludes model-io dumps). */
export function findLatestSessionJsonl(
  workspaceRoot: string | undefined,
): string | undefined {
  if (!workspaceRoot) return undefined;
  const dir = mitiiLogsDir(workspaceRoot);
  try {
    const names = readdirSync(dir)
      .filter(isSessionJsonlName)
      .sort();
    const last = names[names.length - 1];
    return last ? join(dir, last) : undefined;
  } catch {
    return undefined;
  }
}

export interface ShareableDiagnosticMeta {
  providerType?: string;
  model?: string;
  baseUrl?: string;
  mode?: string;
  developerEnabled?: boolean;
  modelIoEnabled?: boolean;
  contextWindowTokens?: number;
}

export interface ShareableDiagnosticSources {
  sessionLogPath?: string;
  modelIoLogPath?: string;
}

export function buildShareableDiagnostic(options: {
  workspaceRoot?: string;
  meta: ShareableDiagnosticMeta;
  sources?: ShareableDiagnosticSources;
}): { markdown: string; sources: ShareableDiagnosticSources } {
  const sessionLogPath =
    options.sources?.sessionLogPath ??
    findLatestSessionJsonl(options.workspaceRoot);
  const modelIoLogPath =
    options.sources?.modelIoLogPath ??
    findLatestModelIoLog(options.workspaceRoot);

  const sessionLines = sessionLogPath ? readJsonlLines(sessionLogPath) : [];
  const modelIoLines = modelIoLogPath ? readJsonlLines(modelIoLogPath) : [];

  const runStart = [...sessionLines]
    .reverse()
    .find((line) => line.kind === 'run_start');
  const runEnd = [...sessionLines]
    .reverse()
    .find((line) => line.kind === 'run_end');

  const warnings = sessionLines
    .filter((line) => line.type === 'warning')
    .slice(-SHAREABLE_LIMITS.maxWarnings)
    .map((line) => ({
      message: preview(String(line.message ?? ''), 300),
      code: line.code,
      stage: line.stage,
    }));

  const tools = sessionLines
    .filter(
      (line) => line.type === 'tool_started' || line.type === 'tool_completed',
    )
    .slice(-SHAREABLE_LIMITS.maxTools)
    .map((line) => ({
      event: line.type,
      tool: line.toolName,
      status: line.status,
      summary: preview(
        typeof line.summary === 'string' ? line.summary : undefined,
        200,
      ),
      reasonCode: line.reasonCode,
    }));

  const stages = sessionLines
    .filter(
      (line) => line.type === 'stage_started' || line.type === 'stage_completed',
    )
    .slice(-40)
    .map((line) => `${line.type === 'stage_started' ? '→' : '✓'} ${line.stage}`);

  const modelTurns = sessionLines
    .filter((line) => line.type === 'model_turn')
    .slice(-20)
    .map((line) => ({
      turn: line.turnIndex,
      in: line.inputTokens,
      out: line.outputTokens,
      finish: line.finishReason,
      truncated: line.truncated,
    }));

  const modelCalls = modelIoLines
    .filter((line) => line.kind === 'model_request')
    .slice(-SHAREABLE_LIMITS.maxModelCalls)
    .map((req) => {
      const callId = req.callId;
      const res = modelIoLines.find(
        (line) => line.kind === 'model_response' && line.callId === callId,
      );
      const request = (req.request ?? {}) as Record<string, unknown>;
      const messages = Array.isArray(request.messages)
        ? (request.messages as Array<Record<string, unknown>>)
        : [];
      const lastUser = [...messages]
        .reverse()
        .find((m) => m.role === 'user');
      return {
        callId,
        portId: req.portId,
        messageCount: request.messageCount,
        toolCount: request.toolCount,
        lastUserPreview: preview(
          typeof lastUser?.content === 'string' ? lastUser.content : undefined,
          SHAREABLE_LIMITS.contentPreviewChars,
        ),
        finishReason: res?.finishReason,
        usage: res?.usage,
        contentPreview: preview(
          typeof res?.content === 'string' ? res.content : undefined,
          SHAREABLE_LIMITS.contentPreviewChars,
        ),
        toolCalls: Array.isArray(res?.toolCalls)
          ? (res.toolCalls as Array<Record<string, unknown>>).map((tc) => ({
              name: tc.name,
              argumentsPreview: preview(
                typeof tc.arguments === 'string' ? tc.arguments : undefined,
                400,
              ),
            }))
          : undefined,
        error: res?.error,
      };
    });

  const prompt = preview(
    typeof runStart?.prompt === 'string' ? runStart.prompt : undefined,
    SHAREABLE_LIMITS.promptPreviewChars,
  );
  const answer = preview(
    typeof runEnd?.answer === 'string' ? runEnd.answer : undefined,
    SHAREABLE_LIMITS.answerPreviewChars,
  );

  const lines: string[] = [
    '# Mitii shareable diagnostic',
    '',
    '_Redacted summary for pasting into an online chat assistant. Does not include API keys or full model wire dumps._',
    '',
    '## Environment',
    '',
    `- Exported at: ${new Date().toISOString()}`,
    `- Provider: ${options.meta.providerType ?? 'unknown'}`,
    `- Model: ${options.meta.model ?? 'unknown'}`,
    `- Base URL: ${options.meta.baseUrl ? redact(options.meta.baseUrl) : 'n/a'}`,
    `- Mode: ${options.meta.mode ?? runStart?.mode ?? 'n/a'}`,
    `- Context window: ${options.meta.contextWindowTokens ?? 'n/a'}`,
    `- Developer settings: ${options.meta.developerEnabled ? 'on' : 'off'}`,
    `- Model I/O logging: ${options.meta.modelIoEnabled ? 'on' : 'off'}`,
    '',
    '## Sources',
    '',
    `- Session log: ${sessionLogPath ? basename(sessionLogPath) : 'none'}`,
    `- Model I/O log: ${modelIoLogPath ? basename(modelIoLogPath) : 'none (enable Developer → Log model I/O)'}`,
    '',
    '## Run',
    '',
    `- Run id: ${runEnd?.runId ?? runStart?.runId ?? 'n/a'}`,
    `- Status: ${runEnd?.status ?? 'n/a'}`,
    `- Route: ${runEnd?.route ?? 'n/a'}`,
    `- Duration ms: ${runEnd?.durationMs ?? 'n/a'}`,
    `- Usage: ${runEnd?.usage ? JSON.stringify(runEnd.usage) : 'n/a'}`,
    '',
    '## User prompt (preview)',
    '',
    '```',
    prompt ?? '(none)',
    '```',
    '',
    '## Answer (preview)',
    '',
    '```',
    answer ?? '(none)',
    '```',
    '',
    '## Stages',
    '',
    ...(stages.length > 0 ? stages.map((s) => `- ${s}`) : ['- (none)']),
    '',
    '## Model turns (token stats)',
    '',
    ...(modelTurns.length > 0
      ? modelTurns.map(
          (t) =>
            `- turn=${t.turn} in=${t.in ?? '?'} out=${t.out ?? '?'}${t.finish ? ` finish=${t.finish}` : ''}${t.truncated ? ' truncated' : ''}`,
        )
      : ['- (none)']),
    '',
    '## Tools',
    '',
    ...(tools.length > 0
      ? tools.map((t) => {
          const bits = [
            String(t.event),
            String(t.tool ?? ''),
            t.status ? `→ ${t.status}` : '',
            t.summary ?? '',
            t.reasonCode ? `(${t.reasonCode})` : '',
          ].filter(Boolean);
          return `- ${bits.join(' ')}`;
        })
      : ['- (none)']),
    '',
    '## Warnings',
    '',
    ...(warnings.length > 0
      ? warnings.map((w) => {
          const bits = [
            w.code ? `[${w.code}]` : '',
            w.stage ? `(${w.stage})` : '',
            w.message ?? '',
          ].filter(Boolean);
          return `- ${bits.join(' ')}`;
        })
      : ['- (none)']),
    '',
    '## Model I/O (previews only)',
    '',
  ];

  if (modelCalls.length === 0) {
    lines.push(
      '- No model I/O records. Turn on **Developer → Log model I/O**, re-run, then export again.',
      '',
    );
  } else {
    for (const [index, call] of modelCalls.entries()) {
      lines.push(`### Call ${index + 1} (\`${call.callId}\`)`);
      lines.push('');
      lines.push(`- Port: ${call.portId ?? 'n/a'}`);
      lines.push(`- Messages: ${call.messageCount ?? 'n/a'} · Tools offered: ${call.toolCount ?? 'n/a'}`);
      lines.push(`- Finish: ${call.finishReason ?? 'n/a'}`);
      if (call.usage) lines.push(`- Usage: ${JSON.stringify(call.usage)}`);
      if (call.error) lines.push(`- Error: ${JSON.stringify(call.error)}`);
      lines.push('');
      lines.push('Last user message preview:');
      lines.push('');
      lines.push('```');
      lines.push(call.lastUserPreview ?? '(none)');
      lines.push('```');
      lines.push('');
      lines.push('Assistant content preview:');
      lines.push('');
      lines.push('```');
      lines.push(call.contentPreview ?? '(none)');
      lines.push('```');
      lines.push('');
      if (call.toolCalls && call.toolCalls.length > 0) {
        lines.push('Tool calls:');
        lines.push('');
        for (const tc of call.toolCalls) {
          lines.push(`- **${tc.name ?? 'unknown'}**`);
          lines.push('  ```');
          lines.push(`  ${tc.argumentsPreview ?? ''}`);
          lines.push('  ```');
        }
        lines.push('');
      }
    }
  }

  lines.push('## How to help');
  lines.push('');
  lines.push(
    'Please diagnose what went wrong in this Mitii agent run and suggest concrete fixes (prompt, tools, routing, or settings). Prefer actionable steps over restating the log.',
  );
  lines.push('');

  return {
    markdown: lines.join('\n'),
    sources: {
      ...(sessionLogPath ? { sessionLogPath } : {}),
      ...(modelIoLogPath ? { modelIoLogPath } : {}),
    },
  };
}

/** Write one markdown file under `.mitii/logs/` for pasting into online chat. */
export function writeShareableDiagnostic(options: {
  workspaceRoot?: string;
  fallbackDir: string;
  meta: ShareableDiagnosticMeta;
  sources?: ShareableDiagnosticSources;
}): { path: string; sources: ShareableDiagnosticSources } {
  const built = buildShareableDiagnostic(options);
  const dir = options.workspaceRoot
    ? mitiiLogsDir(options.workspaceRoot)
    : options.fallbackDir;
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `shareable-diagnostic-${stamp()}.md`);
  writeFileSync(outPath, built.markdown, 'utf8');
  return { path: outPath, sources: built.sources };
}
