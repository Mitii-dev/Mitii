#!/usr/bin/env node
/**
 * Standalone Mitii Log Viewer.
 *
 *   node tools/log-viewer/server.mjs
 *   node tools/log-viewer/server.mjs --root /path/to/repo
 *
 * Opens a browser UI for inspecting `.mitii/logs` without shipping anything in
 * the VS Code extension bundle.
 */
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const DEFAULT_ROOT = resolve(__dirname, '../..');
const MAX_LOG_FILES = 80;
const MAX_LOG_BYTES = 8_000_000;
const MAX_CALLS = 180;
const MAX_TIMELINE_EVENTS = 500;

function argValue(name, fallback) {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const PORT = Number(argValue('--port', process.env.LOG_VIEWER_PORT || 8797));
const HOST = argValue('--host', process.env.LOG_VIEWER_HOST || '127.0.0.1');
const START_ROOT = resolvePath(
  argValue('--root', process.env.LOG_VIEWER_ROOT || process.cwd()),
);

function resolvePath(input) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_ROOT;
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendFile(res, filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  const type = types[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(readFileSync(filePath));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value) {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function asRecords(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function compactPath(path) {
  return path.replace(process.env.HOME || '', '~');
}

function resolveLogsDir(rootInput) {
  const root = resolvePath(rootInput || START_ROOT);
  const candidates = basename(root) === 'logs'
    ? [root]
    : [
        join(root, '.mitii', 'logs'),
        basename(root) === '.mitii' ? join(root, 'logs') : '',
        root.endsWith(join('.mitii', 'logs')) ? root : '',
      ].filter(Boolean);
  const logsDir = candidates.find((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
  if (!logsDir) {
    return {
      root,
      logsDir: join(root, '.mitii', 'logs'),
      exists: false,
    };
  }
  const repoRoot = logsDir.endsWith(join('.mitii', 'logs'))
    ? dirname(dirname(logsDir))
    : root;
  return { root: repoRoot, logsDir, exists: true };
}

function readLogText(path, sizeBytes) {
  if (sizeBytes <= MAX_LOG_BYTES) {
    return { text: readFileSync(path, 'utf8'), truncated: false };
  }
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(MAX_LOG_BYTES);
    const offset = Math.max(0, sizeBytes - MAX_LOG_BYTES);
    const bytesRead = readSync(fd, buffer, 0, MAX_LOG_BYTES, offset);
    return { text: buffer.toString('utf8', 0, bytesRead), truncated: true };
  } finally {
    closeSync(fd);
  }
}

function parseJsonl(path, sizeBytes) {
  const { text, truncated } = readLogText(path, sizeBytes);
  const lines = text.split(/\r?\n/);
  const readableLines = truncated ? lines.slice(1) : lines;
  const entries = [];
  const malformed = [];
  readableLines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) entries.push(parsed);
    } catch (error) {
      malformed.push({
        line: truncated ? index + 2 : index + 1,
        message: error instanceof Error ? error.message : 'Invalid JSON',
      });
    }
  });
  return { entries, truncated, malformed };
}

function detectType(name) {
  if (name.endsWith('-model-io.jsonl')) return 'model_io';
  if (name.endsWith('.jsonl')) return 'session';
  if (name.startsWith('session-export-') && name.endsWith('.json')) {
    return 'session_export';
  }
  return 'other';
}

function sessionIdFromName(name, type) {
  if (type === 'model_io') {
    return name.replace(/^[^-]+-[^-]+-[^-]+-[^-]+-[^-]+-/, '').replace(/-model-io\.jsonl$/, '');
  }
  if (type === 'session') {
    return name.replace(/^[^-]+-[^-]+-[^-]+-[^-]+-[^-]+-/, '').replace(/\.jsonl$/, '');
  }
  return undefined;
}

function listLogFiles(logsDir) {
  if (!existsSync(logsDir)) return [];
  return readdirSync(logsDir)
    .filter((name) => {
      const type = detectType(name);
      return type === 'model_io' || type === 'session' || type === 'session_export';
    })
    .map((name) => {
      const path = join(logsDir, name);
      const stats = statSync(path);
      const type = detectType(name);
      return {
        id: name,
        name,
        type,
        path,
        sizeBytes: stats.size,
        updatedAt: stats.mtime.toISOString(),
        sessionId: sessionIdFromName(name, type),
      };
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_LOG_FILES);
}

function mapMessage(message) {
  return {
    role: asString(message.role) || 'message',
    content: asString(message.content) || '',
    contentChars: asNumber(message.contentChars),
    toolCallId: asString(message.toolCallId),
    truncated: asBoolean(message.truncated),
    redacted: asBoolean(message.redacted),
    toolCalls: asRecords(message.toolCalls).map((call) => ({
      id: asString(call.id),
      name: asString(call.name) || 'tool_call',
      arguments: asString(call.arguments) || '',
      argumentChars: asNumber(call.argumentChars),
      truncated: asBoolean(call.truncated),
      redacted: asBoolean(call.redacted),
    })),
  };
}

function mapTool(tool) {
  return {
    name: asString(tool.name) || 'tool',
    description: asString(tool.description) || '',
  };
}

function addIssue(issues, issue) {
  issues.push({
    severity: issue.severity || 'warning',
    title: issue.title,
    detail: issue.detail || '',
    callId: issue.callId,
    source: issue.source || 'log',
  });
}

function isJsonLike(value) {
  const text = String(value || '').trim();
  return text.startsWith('{') || text.startsWith('[');
}

function detectToolArgIssues(issues, callId, toolCalls, source) {
  for (const toolCall of toolCalls || []) {
    const args = toolCall.arguments;
    if (!args || !isJsonLike(args)) continue;
    try {
      JSON.parse(args);
    } catch (error) {
      addIssue(issues, {
        severity: 'error',
        title: `Invalid tool arguments: ${toolCall.name || 'tool call'}`,
        detail: error instanceof Error ? error.message : 'Arguments are not valid JSON.',
        callId,
        source,
      });
    }
  }
}

function ensureCall(calls, order, callId) {
  if (calls.has(callId)) return calls.get(callId);
  const call = {
    callId,
    input: [],
    tools: [],
    output: null,
    issues: [],
  };
  calls.set(callId, call);
  order.push(callId);
  return call;
}

function parseModelIoFile(file) {
  const parsed = parseJsonl(file.path, file.sizeBytes);
  const calls = new Map();
  const order = [];
  const issues = [];
  const runIds = new Set();
  let requestCount = 0;
  let responseCount = 0;

  for (const malformed of parsed.malformed) {
    addIssue(issues, {
      severity: 'warning',
      title: `Malformed JSONL line ${malformed.line}`,
      detail: malformed.message,
      source: file.name,
    });
  }

  for (const entry of parsed.entries) {
    const kind = asString(entry.kind);
    if (asString(entry.runId)) runIds.add(asString(entry.runId));
    if (kind !== 'model_request' && kind !== 'model_response') continue;
    const callId = asString(entry.callId);
    if (!callId) continue;
    const call = ensureCall(calls, order, callId);
    call.runId = call.runId || asString(entry.runId);
    call.requestId = call.requestId || asString(entry.requestId);
    call.portId = call.portId || asString(entry.portId);

    if (kind === 'model_request') {
      requestCount += 1;
      const request = isRecord(entry.request) ? entry.request : {};
      call.startedAt = asString(entry.at) || call.startedAt;
      call.model = asString(request.model) || call.model;
      call.maximumOutputTokens = asNumber(request.maximumOutputTokens);
      call.temperature = asNumber(request.temperature);
      call.stream = asBoolean(request.stream);
      call.toolChoice = request.toolChoice;
      call.messageCount = asNumber(request.messageCount);
      call.toolCount = asNumber(request.toolCount);
      call.messagesTruncated = asBoolean(request.messagesTruncated);
      call.toolsTruncated = asBoolean(request.toolsTruncated);
      call.input = asRecords(request.messages).map(mapMessage);
      call.tools = asRecords(request.tools).map(mapTool);
      call.rawRequest = entry;
      detectToolArgIssues(issues, callId, call.input.flatMap((message) => message.toolCalls || []), file.name);
      if (call.messagesTruncated) {
        addIssue(issues, {
          severity: 'warning',
          title: 'Input messages were truncated',
          detail: 'The model I/O logger clipped part of the request for this call.',
          callId,
          source: file.name,
        });
      }
      if (call.toolsTruncated) {
        addIssue(issues, {
          severity: 'info',
          title: 'Tool definitions were truncated',
          detail: 'Only the first tool definitions were kept in the log.',
          callId,
          source: file.name,
        });
      }
    } else {
      responseCount += 1;
      call.completedAt = asString(entry.at) || call.completedAt;
      call.finishReason = asString(entry.finishReason) || 'unknown';
      call.usage = isRecord(entry.usage) ? entry.usage : null;
      call.output = {
        content: asString(entry.content) || '',
        contentChars: asNumber(entry.contentChars),
        contentTruncated: asBoolean(entry.contentTruncated),
        contentRedacted: asBoolean(entry.contentRedacted),
        reasoning: asString(entry.reasoning) || '',
        reasoningChars: asNumber(entry.reasoningChars),
        reasoningTruncated: asBoolean(entry.reasoningTruncated),
        toolCalls: asRecords(entry.toolCalls).map((toolCall) => ({
          index: asNumber(toolCall.index) || 0,
          id: asString(toolCall.id),
          name: asString(toolCall.name) || 'tool_call',
          arguments: asString(toolCall.arguments) || '',
          argumentChars: asNumber(toolCall.argumentChars),
          truncated: asBoolean(toolCall.truncated),
          redacted: asBoolean(toolCall.redacted),
        })),
        error: isRecord(entry.error) ? entry.error : null,
      };
      call.rawResponse = entry;
      detectToolArgIssues(issues, callId, call.output.toolCalls, file.name);
      if (call.output.error) {
        addIssue(issues, {
          severity: 'error',
          title: `Provider error in ${callId}`,
          detail: asString(call.output.error.message) || JSON.stringify(call.output.error),
          callId,
          source: file.name,
        });
      }
      if (call.finishReason && !['stop', 'tool_calls', 'end_turn'].includes(call.finishReason)) {
        addIssue(issues, {
          severity: call.finishReason === 'length' ? 'error' : 'warning',
          title: `Finish reason: ${call.finishReason}`,
          detail: 'This can explain incomplete answers, missing tool calls, or cancelled runs.',
          callId,
          source: file.name,
        });
      }
      if (call.output.contentTruncated || call.output.reasoningTruncated) {
        addIssue(issues, {
          severity: 'warning',
          title: 'Response was truncated in the log',
          detail: 'The logged response was clipped. Open the raw file or raise log limits if needed.',
          callId,
          source: file.name,
        });
      }
      if (!call.output.content && (!call.output.toolCalls || call.output.toolCalls.length === 0) && !call.output.error) {
        addIssue(issues, {
          severity: 'warning',
          title: 'Empty model response',
          detail: 'The model produced no text, no tool calls, and no provider error.',
          callId,
          source: file.name,
        });
      }
    }
  }

  const callList = order.map((id) => calls.get(id));
  for (const call of callList) {
    if (!call.rawRequest) {
      addIssue(issues, {
        severity: 'warning',
        title: `Missing request for ${call.callId}`,
        detail: 'A response exists without its matching request in the loaded portion.',
        callId: call.callId,
        source: file.name,
      });
    }
    if (!call.rawResponse) {
      addIssue(issues, {
        severity: 'warning',
        title: `Missing response for ${call.callId}`,
        detail: 'The run may still be active, cancelled, or the file may be truncated.',
        callId: call.callId,
        source: file.name,
      });
    }
    call.issues = issues.filter((issue) => issue.callId === call.callId);
  }

  return {
    calls: callList.slice(-MAX_CALLS).reverse(),
    issues,
    runIds: [...runIds],
    requestCount,
    responseCount,
    truncated: parsed.truncated,
  };
}

function summarizeSessionEvent(event) {
  const kind = asString(event.kind) || asString(event.type) || 'event';
  const type = asString(event.type);
  if (kind === 'run_start') return `Run started: ${asString(event.prompt) || ''}`;
  if (kind === 'run_end') return `Run ended: ${asString(event.status) || 'unknown'}`;
  if (type === 'model_turn') {
    return `Model turn ${event.turnIndex ?? ''}: in ${event.inputTokens ?? '-'} / out ${event.outputTokens ?? '-'} / ${event.finishReason ?? '-'}`;
  }
  if (type === 'tool_completed' || type === 'tool_failed' || type === 'tool_running') {
    return `${type.replace(/_/g, ' ')}: ${asString(event.toolName) || asString(event.title) || ''}`;
  }
  if (type === 'verification_completed') {
    return `Verification: ${asString(event.status) || 'unknown'}`;
  }
  if (type === 'decision_made') {
    return `Decision: ${asString(event.route) || 'route'} / ${asString(event.runDisposition) || ''}`;
  }
  return asString(event.title) || asString(event.detail) || kind;
}

function parseSessionFile(file) {
  const parsed = parseJsonl(file.path, file.sizeBytes);
  const issues = [];
  const events = parsed.entries.slice(-MAX_TIMELINE_EVENTS).map((entry, index) => ({
    id: `${file.id}:${index}`,
    at: asString(entry.at),
    kind: asString(entry.kind) || asString(entry.type) || 'event',
    summary: summarizeSessionEvent(entry),
    raw: entry,
  }));
  for (const entry of parsed.entries) {
    const kind = asString(entry.kind);
    const type = asString(entry.type);
    const status = asString(entry.status);
    if (kind === 'run_end' && status && status !== 'succeeded') {
      addIssue(issues, {
        severity: status === 'failed' || status === 'budget_exhausted' ? 'error' : 'warning',
        title: `Run ended as ${status}`,
        detail: isRecord(entry.error) ? asString(entry.error.message) || JSON.stringify(entry.error) : '',
        source: file.name,
      });
    }
    if (type === 'tool_failed') {
      addIssue(issues, {
        severity: 'error',
        title: `Tool failed: ${asString(entry.toolName) || 'tool'}`,
        detail: asString(entry.detail) || asString(entry.error) || '',
        source: file.name,
      });
    }
    if (type === 'verification_completed' && status && status !== 'passed') {
      addIssue(issues, {
        severity: 'warning',
        title: `Verification ${status}`,
        detail: JSON.stringify(entry.checks || entry.diagnostics || entry.reasonCodes || []),
        source: file.name,
      });
    }
  }
  for (const malformed of parsed.malformed) {
    addIssue(issues, {
      severity: 'warning',
      title: `Malformed JSONL line ${malformed.line}`,
      detail: malformed.message,
      source: file.name,
    });
  }
  return { events, issues, truncated: parsed.truncated };
}

function selectedFile(files, fileId) {
  if (fileId && !fileId.includes('/') && !fileId.includes('\\')) {
    const match = files.find((file) => file.id === fileId);
    if (match) return match;
  }
  return files.find((file) => file.type === 'model_io') || files[0];
}

function buildPayload(rootInput, fileId) {
  const resolved = resolveLogsDir(rootInput);
  const files = resolved.exists ? listLogFiles(resolved.logsDir) : [];
  const selected = selectedFile(files, fileId);
  const payload = {
    root: resolved.root,
    rootLabel: compactPath(resolved.root),
    logsDir: resolved.logsDir,
    logsDirLabel: compactPath(resolved.logsDir),
    logsDirExists: resolved.exists,
    files,
    selectedFileId: selected?.id,
    calls: [],
    timeline: [],
    issues: [],
    stats: {
      fileCount: files.length,
      callCount: 0,
      errorCount: 0,
      warningCount: 0,
      requestCount: 0,
      responseCount: 0,
    },
    truncated: false,
  };

  if (!resolved.exists || !selected) return payload;

  if (selected.type === 'model_io') {
    const parsed = parseModelIoFile(selected);
    selected.runIds = parsed.runIds;
    selected.callCount = parsed.calls.length;
    selected.requestCount = parsed.requestCount;
    selected.responseCount = parsed.responseCount;
    selected.issueCount = parsed.issues.length;
    payload.calls = parsed.calls;
    payload.issues = parsed.issues;
    payload.truncated = parsed.truncated;
    payload.stats.callCount = parsed.calls.length;
    payload.stats.requestCount = parsed.requestCount;
    payload.stats.responseCount = parsed.responseCount;
  } else if (selected.type === 'session') {
    const parsed = parseSessionFile(selected);
    selected.issueCount = parsed.issues.length;
    payload.timeline = parsed.events.reverse();
    payload.issues = parsed.issues;
    payload.truncated = parsed.truncated;
  }

  payload.stats.errorCount = payload.issues.filter((issue) => issue.severity === 'error').length;
  payload.stats.warningCount = payload.issues.filter((issue) => issue.severity === 'warning').length;
  return payload;
}

function safePublicPath(pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const resolved = resolve(PUBLIC, relative);
  if (!resolved.startsWith(PUBLIC)) return undefined;
  return resolved;
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (url.pathname === '/api/load') {
      sendJson(
        res,
        200,
        buildPayload(url.searchParams.get('root') || START_ROOT, url.searchParams.get('file')),
      );
      return;
    }
    if (url.pathname === '/api/default-root') {
      sendJson(res, 200, { root: START_ROOT, rootLabel: compactPath(START_ROOT) });
      return;
    }
    const filePath = safePublicPath(url.pathname);
    if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`Mitii Log Viewer running at ${url}`);
  console.log(`Default repo: ${START_ROOT}`);
  if (!process.argv.includes('--no-open') && process.env.LOG_VIEWER_OPEN !== '0') {
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'cmd'
          : 'xdg-open';
    const args =
      process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    execFile(opener, args, { stdio: 'ignore' }, () => {});
  }
});
