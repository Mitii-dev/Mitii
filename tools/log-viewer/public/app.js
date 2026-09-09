const state = {
  payload: null,
  root: '',
  selectedFileId: '',
  selectedCallId: '',
  filter: 'all',
  search: '',
  rawOpen: false,
  clientFiles: null,
};

const els = {
  repoPath: document.querySelector('#repo-path'),
  loadPath: document.querySelector('#load-path'),
  chooseFolder: document.querySelector('#choose-folder'),
  folderInput: document.querySelector('#folder-input'),
  refresh: document.querySelector('#refresh'),
  workspaceLabel: document.querySelector('#workspace-label'),
  logsDir: document.querySelector('#logs-dir'),
  metricFiles: document.querySelector('#metric-files'),
  metricCalls: document.querySelector('#metric-calls'),
  metricErrors: document.querySelector('#metric-errors'),
  metricWarnings: document.querySelector('#metric-warnings'),
  fileList: document.querySelector('#file-list'),
  selectedFileLabel: document.querySelector('#selected-file-label'),
  issuePanel: document.querySelector('#issue-panel'),
  turnList: document.querySelector('#turn-list'),
  search: document.querySelector('#search'),
  detailEmpty: document.querySelector('#detail-empty'),
  detail: document.querySelector('#detail'),
  timelineDetail: document.querySelector('#timeline-detail'),
  detailEyebrow: document.querySelector('#detail-eyebrow'),
  detailTitle: document.querySelector('#detail-title'),
  detailMeta: document.querySelector('#detail-meta'),
  inputCount: document.querySelector('#input-count'),
  outputCount: document.querySelector('#output-count'),
  inputContent: document.querySelector('#input-content'),
  outputContent: document.querySelector('#output-content'),
  rawPanel: document.querySelector('#raw-panel'),
  rawRequest: document.querySelector('#raw-request'),
  rawResponse: document.querySelector('#raw-response'),
  copySummary: document.querySelector('#copy-summary'),
  toggleRaw: document.querySelector('#toggle-raw'),
  timeline: document.querySelector('#timeline'),
  timelineMeta: document.querySelector('#timeline-meta'),
  toast: document.querySelector('#toast'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  return html;
}

function renderMarkdown(text) {
  const source = String(text || '').replace(/\r\n/g, '\n');
  if (!source.trim()) return '<p class="empty-line">No text content.</p>';
  const lines = source.split('\n');
  const html = [];
  let paragraph = [];
  let list = null;
  let blockquote = [];
  let codeFence = null;
  let table = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushBlockquote = () => {
    if (!blockquote.length) return;
    html.push(`<blockquote>${blockquote.map((line) => inlineMarkdown(line)).join('<br>')}</blockquote>`);
    blockquote = [];
  };
  const flushTable = () => {
    if (table.length < 2) {
      paragraph.push(...table);
      table = [];
      return;
    }
    const rows = table.map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell, index, arr) => !(index === 0 && cell === '') && !(index === arr.length - 1 && cell === '')),
    );
    const separator = rows[1] || [];
    const isSeparator = separator.every((cell) => /^:?-{3,}:?$/.test(cell));
    if (!isSeparator) {
      paragraph.push(...table);
      table = [];
      return;
    }
    const head = rows[0] || [];
    const body = rows.slice(2);
    html.push(
      `<table><thead><tr>${head.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body
        .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`,
    );
    table = [];
  };
  const flushAll = () => {
    flushTable();
    flushParagraph();
    flushList();
    flushBlockquote();
  };

  for (const line of lines) {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      if (codeFence) {
        html.push(`<pre><code>${escapeHtml(codeFence.lines.join('\n'))}</code></pre>`);
        codeFence = null;
      } else {
        flushAll();
        codeFence = { lang: fence[1].trim(), lines: [] };
      }
      continue;
    }
    if (codeFence) {
      codeFence.lines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    if (/^\|.+\|$/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushBlockquote();
      table.push(line.trim());
      continue;
    }
    flushTable();
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blockquote.push(quote[1]);
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushBlockquote();
      const type = ordered ? 'ol' : 'ul';
      if (!list || list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((unordered || ordered)[1]);
      continue;
    }
    paragraph.push(line.trim());
  }
  if (codeFence) {
    html.push(`<pre><code>${escapeHtml(codeFence.lines.join('\n'))}</code></pre>`);
  }
  flushAll();
  return html.join('');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value) {
  return Array.isArray(value) ? value.filter(record) : [];
}

function issue(severity, title, detail = '', callId = '', source = 'log') {
  return { severity, title, detail, callId, source };
}

function parseJsonlText(text, truncated = false) {
  const entries = [];
  const malformed = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      if (record(parsed)) entries.push(parsed);
    } catch (error) {
      malformed.push({
        line: index + 1,
        message: error instanceof Error ? error.message : 'Invalid JSON',
      });
    }
  });
  return { entries, malformed, truncated };
}

function fileType(name) {
  if (name.endsWith('-model-io.jsonl')) return 'model_io';
  if (name.endsWith('.jsonl')) return 'session';
  if (name.startsWith('session-export-') && name.endsWith('.json')) return 'session_export';
  return 'other';
}

function sessionIdFromName(name, type) {
  if (type === 'model_io') {
    return name.replace(/^[^-]+-[^-]+-[^-]+-[^-]+-[^-]+-/, '').replace(/-model-io\.jsonl$/, '');
  }
  if (type === 'session') {
    return name.replace(/^[^-]+-[^-]+-[^-]+-[^-]+-[^-]+-/, '').replace(/\.jsonl$/, '');
  }
  return '';
}

function modelMessage(message) {
  return {
    role: message.role || 'message',
    content: message.content || '',
    contentChars: message.contentChars,
    toolCallId: message.toolCallId,
    truncated: message.truncated === true,
    redacted: message.redacted === true,
    toolCalls: records(message.toolCalls).map((call) => ({
      id: call.id,
      name: call.name || 'tool_call',
      arguments: call.arguments || '',
      argumentChars: call.argumentChars,
      truncated: call.truncated === true,
      redacted: call.redacted === true,
    })),
  };
}

function modelTool(tool) {
  return {
    name: tool.name || 'tool',
    description: tool.description || '',
  };
}

function jsonLooksInvalid(args) {
  const text = String(args || '').trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return '';
  try {
    JSON.parse(text);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid JSON';
  }
}

function pushToolArgIssues(issues, callId, toolCalls, source) {
  for (const call of toolCalls || []) {
    const error = jsonLooksInvalid(call.arguments);
    if (error) {
      issues.push(issue('error', `Invalid tool arguments: ${call.name}`, error, callId, source));
    }
  }
}

function ensureCall(calls, order, callId) {
  if (calls.has(callId)) return calls.get(callId);
  const call = { callId, input: [], tools: [], output: null, issues: [] };
  calls.set(callId, call);
  order.push(callId);
  return call;
}

function parseModelIoEntries(file, parsed) {
  const calls = new Map();
  const order = [];
  const issues = parsed.malformed.map((bad) =>
    issue('warning', `Malformed JSONL line ${bad.line}`, bad.message, '', file.name),
  );
  const runIds = new Set();
  let requestCount = 0;
  let responseCount = 0;

  for (const entry of parsed.entries) {
    const kind = entry.kind;
    if (entry.runId) runIds.add(entry.runId);
    if (kind !== 'model_request' && kind !== 'model_response') continue;
    if (!entry.callId) continue;
    const call = ensureCall(calls, order, entry.callId);
    call.runId ||= entry.runId;
    call.requestId ||= entry.requestId;
    call.portId ||= entry.portId;
    if (kind === 'model_request') {
      requestCount += 1;
      const req = record(entry.request) ? entry.request : {};
      call.startedAt = entry.at || call.startedAt;
      call.model = req.model || call.model;
      call.maximumOutputTokens = req.maximumOutputTokens;
      call.temperature = req.temperature;
      call.stream = req.stream;
      call.toolChoice = req.toolChoice;
      call.messageCount = req.messageCount;
      call.toolCount = req.toolCount;
      call.messagesTruncated = req.messagesTruncated === true;
      call.toolsTruncated = req.toolsTruncated === true;
      call.input = records(req.messages).map(modelMessage);
      call.tools = records(req.tools).map(modelTool);
      call.rawRequest = entry;
      pushToolArgIssues(issues, call.callId, call.input.flatMap((message) => message.toolCalls || []), file.name);
      if (call.messagesTruncated) {
        issues.push(issue('warning', 'Input messages were truncated', 'Part of the request was clipped by the log writer.', call.callId, file.name));
      }
      if (call.toolsTruncated) {
        issues.push(issue('info', 'Tool definitions were truncated', 'Only part of the offered tool list was logged.', call.callId, file.name));
      }
    } else {
      responseCount += 1;
      call.completedAt = entry.at || call.completedAt;
      call.finishReason = entry.finishReason || 'unknown';
      call.usage = record(entry.usage) ? entry.usage : null;
      call.output = {
        content: entry.content || '',
        contentChars: entry.contentChars,
        contentTruncated: entry.contentTruncated === true,
        contentRedacted: entry.contentRedacted === true,
        reasoning: entry.reasoning || '',
        reasoningChars: entry.reasoningChars,
        reasoningTruncated: entry.reasoningTruncated === true,
        toolCalls: records(entry.toolCalls).map((toolCall) => ({
          index: toolCall.index || 0,
          id: toolCall.id,
          name: toolCall.name || 'tool_call',
          arguments: toolCall.arguments || '',
          argumentChars: toolCall.argumentChars,
          truncated: toolCall.truncated === true,
          redacted: toolCall.redacted === true,
        })),
        error: record(entry.error) ? entry.error : null,
      };
      call.rawResponse = entry;
      pushToolArgIssues(issues, call.callId, call.output.toolCalls, file.name);
      if (call.output.error) {
        issues.push(issue('error', `Provider error in ${call.callId}`, call.output.error.message || JSON.stringify(call.output.error), call.callId, file.name));
      }
      if (call.finishReason && !['stop', 'tool_calls', 'end_turn'].includes(call.finishReason)) {
        issues.push(issue(call.finishReason === 'length' ? 'error' : 'warning', `Finish reason: ${call.finishReason}`, 'This often explains incomplete output, cancelled flow, or missing tool calls.', call.callId, file.name));
      }
      if (call.output.contentTruncated || call.output.reasoningTruncated) {
        issues.push(issue('warning', 'Response was truncated in the log', 'The viewer can only show the clipped payload that was recorded.', call.callId, file.name));
      }
      if (!call.output.content && !call.output.error && (!call.output.toolCalls || call.output.toolCalls.length === 0)) {
        issues.push(issue('warning', 'Empty model response', 'The model produced no text, no tool calls, and no recorded error.', call.callId, file.name));
      }
    }
  }

  const callsList = order.map((id) => calls.get(id)).slice(-180).reverse();
  for (const call of callsList) {
    if (!call.rawRequest) {
      issues.push(issue('warning', `Missing request for ${call.callId}`, 'A response exists without its matching request.', call.callId, file.name));
    }
    if (!call.rawResponse) {
      issues.push(issue('warning', `Missing response for ${call.callId}`, 'This may be a live run, cancelled run, or truncated log.', call.callId, file.name));
    }
    call.issues = issues.filter((item) => item.callId === call.callId);
  }

  return {
    calls: callsList,
    timeline: [],
    issues,
    runIds: [...runIds],
    requestCount,
    responseCount,
    truncated: parsed.truncated,
  };
}

function sessionSummary(entry) {
  const kind = entry.kind || entry.type || 'event';
  if (kind === 'run_start') return `Run started: ${entry.prompt || ''}`;
  if (kind === 'run_end') return `Run ended: ${entry.status || 'unknown'}`;
  if (entry.type === 'model_turn') {
    return `Model turn ${entry.turnIndex ?? ''}: in ${entry.inputTokens ?? '-'} / out ${entry.outputTokens ?? '-'} / ${entry.finishReason ?? '-'}`;
  }
  if (entry.type === 'verification_completed') return `Verification: ${entry.status || 'unknown'}`;
  if (entry.type === 'decision_made') return `Decision: ${entry.route || ''} / ${entry.runDisposition || ''}`;
  if (entry.type && entry.type.startsWith('tool_')) return `${entry.type.replace(/_/g, ' ')}: ${entry.toolName || entry.title || ''}`;
  return entry.title || entry.detail || kind;
}

function parseSessionEntries(file, parsed) {
  const issues = parsed.malformed.map((bad) =>
    issue('warning', `Malformed JSONL line ${bad.line}`, bad.message, '', file.name),
  );
  const timeline = parsed.entries.slice(-500).reverse().map((entry, index) => ({
    id: `${file.id}:${index}`,
    at: entry.at,
    kind: entry.kind || entry.type || 'event',
    summary: sessionSummary(entry),
    raw: entry,
  }));
  for (const entry of parsed.entries) {
    if (entry.kind === 'run_end' && entry.status && entry.status !== 'succeeded') {
      issues.push(issue(
        entry.status === 'failed' || entry.status === 'budget_exhausted' ? 'error' : 'warning',
        `Run ended as ${entry.status}`,
        record(entry.error) ? entry.error.message || JSON.stringify(entry.error) : '',
        '',
        file.name,
      ));
    }
    if (entry.type === 'tool_failed') {
      issues.push(issue('error', `Tool failed: ${entry.toolName || 'tool'}`, entry.detail || entry.error || '', '', file.name));
    }
    if (entry.type === 'verification_completed' && entry.status && entry.status !== 'passed') {
      issues.push(issue('warning', `Verification ${entry.status}`, JSON.stringify(entry.checks || entry.diagnostics || entry.reasonCodes || []), '', file.name));
    }
  }
  return { calls: [], timeline, issues, truncated: parsed.truncated };
}

async function buildPayloadFromBrowserFiles(files) {
  const candidates = [...files]
    .filter((file) => {
      const path = file.webkitRelativePath || file.name;
      return path.includes('.mitii/logs/') && ['model_io', 'session', 'session_export'].includes(fileType(file.name));
    })
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, 80);
  const payload = {
    root: 'browser-folder',
    rootLabel: candidates[0]?.webkitRelativePath?.split('/')[0] || 'Browser selected folder',
    logsDir: '.mitii/logs',
    logsDirLabel: '.mitii/logs from selected folder',
    logsDirExists: candidates.length > 0,
    files: candidates.map((file) => {
      const type = fileType(file.name);
      return {
        id: file.webkitRelativePath || file.name,
        name: file.name,
        type,
        path: file.webkitRelativePath || file.name,
        sizeBytes: file.size,
        updatedAt: new Date(file.lastModified).toISOString(),
        sessionId: sessionIdFromName(file.name, type),
      };
    }),
    selectedFileId: '',
    calls: [],
    timeline: [],
    issues: [],
    stats: { fileCount: candidates.length, callCount: 0, errorCount: 0, warningCount: 0, requestCount: 0, responseCount: 0 },
    truncated: false,
  };
  payload.selectedFileId = payload.files.find((file) => file.type === 'model_io')?.id || payload.files[0]?.id || '';
  if (payload.selectedFileId) {
    return loadBrowserFile(payload, payload.selectedFileId, candidates);
  }
  return payload;
}

async function loadBrowserFile(payload, fileId, files) {
  const file = files.find((item) => (item.webkitRelativePath || item.name) === fileId);
  const selected = payload.files.find((item) => item.id === fileId);
  if (!file || !selected) return payload;
  const text = await file.text();
  const parsed = parseJsonlText(text);
  const result = selected.type === 'model_io'
    ? parseModelIoEntries(selected, parsed)
    : parseSessionEntries(selected, parsed);
  Object.assign(selected, {
    runIds: result.runIds || [],
    callCount: result.calls.length,
    requestCount: result.requestCount || 0,
    responseCount: result.responseCount || 0,
    issueCount: result.issues.length,
  });
  return {
    ...payload,
    selectedFileId: fileId,
    calls: result.calls,
    timeline: result.timeline,
    issues: result.issues,
    truncated: result.truncated,
    stats: {
      fileCount: payload.files.length,
      callCount: result.calls.length,
      errorCount: result.issues.filter((item) => item.severity === 'error').length,
      warningCount: result.issues.filter((item) => item.severity === 'warning').length,
      requestCount: result.requestCount || 0,
      responseCount: result.responseCount || 0,
    },
  };
}

function selectedFile() {
  return state.payload?.files?.find((file) => file.id === state.selectedFileId) || null;
}

function selectedCall() {
  return state.payload?.calls?.find((call) => call.callId === state.selectedCallId) || state.payload?.calls?.[0] || null;
}

function setToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 2500);
}

function fileMatchesFilter(file) {
  return state.filter === 'all' || file.type === state.filter;
}

function textMatchesCall(call) {
  const query = state.search.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    call.callId,
    call.runId,
    call.model,
    call.finishReason,
    ...call.input.map((message) => `${message.role} ${message.content}`),
    ...(call.output ? [call.output.content, call.output.reasoning] : []),
    ...call.tools.map((tool) => `${tool.name} ${tool.description}`),
    ...call.issues.map((item) => `${item.title} ${item.detail}`),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}

function updateMetrics() {
  const payload = state.payload;
  els.workspaceLabel.textContent = payload?.rootLabel || 'Not loaded';
  els.logsDir.textContent = payload?.logsDirLabel || 'Select a repo that has .mitii/logs';
  els.metricFiles.textContent = String(payload?.stats?.fileCount || payload?.files?.length || 0);
  els.metricCalls.textContent = String(payload?.stats?.callCount || 0);
  els.metricErrors.textContent = String(payload?.stats?.errorCount || 0);
  els.metricWarnings.textContent = String(payload?.stats?.warningCount || 0);
}

function badgeForFile(file) {
  if (file.type === 'model_io') return '<span class="badge badge--model">Model I/O</span>';
  if (file.type === 'session') return '<span class="badge badge--session">Session</span>';
  return '<span class="badge">Export</span>';
}

function renderFileList() {
  const files = (state.payload?.files || []).filter(fileMatchesFilter);
  if (!state.payload?.logsDirExists) {
    els.fileList.innerHTML = '<div class="detail-empty"><h2>No logs folder</h2><p>The selected repo does not contain .mitii/logs.</p></div>';
    return;
  }
  if (!files.length) {
    els.fileList.innerHTML = '<div class="detail-empty"><h2>No files</h2><p>No matching log files found.</p></div>';
    return;
  }
  els.fileList.innerHTML = files
    .map((file) => `
      <button class="file-card ${file.id === state.selectedFileId ? 'is-active' : ''}" type="button" data-file-id="${escapeHtml(file.id)}">
        <span class="card-title">
          <strong>${escapeHtml(file.sessionId || file.name)}</strong>
          ${badgeForFile(file)}
        </span>
        <span class="card-meta">${formatDate(file.updatedAt)} · ${formatBytes(file.sizeBytes)}</span>
        <span class="card-sub mono">${escapeHtml(file.name)}</span>
      </button>
    `)
    .join('');
}

function issueBadge(issueItem) {
  const cls = issueItem.severity === 'error' ? 'badge--error' : issueItem.severity === 'warning' ? 'badge--warning' : '';
  return `<span class="badge ${cls}">${escapeHtml(issueItem.severity)}</span>`;
}

function renderIssues() {
  const issues = state.payload?.issues || [];
  if (!issues.length) {
    els.issuePanel.innerHTML = '<button class="issue-card" type="button"><span class="issue-dot" style="background:var(--ok)"></span><span><strong>No bug signals</strong><span>No errors, truncations, or missing pairs detected in this file.</span></span></button>';
    return;
  }
  els.issuePanel.innerHTML = issues.slice(0, 12).map((item) => `
    <button class="issue-card issue-card--${escapeHtml(item.severity)}" type="button" data-call-id="${escapeHtml(item.callId || '')}">
      <span class="issue-dot"></span>
      <span><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail || item.source || '')}</span></span>
    </button>
  `).join('');
}

function renderTurnList() {
  const file = selectedFile();
  els.selectedFileLabel.textContent = file ? `${file.name} · ${file.type.replace('_', ' ')}` : 'No file selected';
  if (file?.type === 'session') {
    els.turnList.innerHTML = '<div class="detail-empty"><h2>Timeline loaded</h2><p>Select another model I/O log to view request and response pairs.</p></div>';
    return;
  }
  const calls = (state.payload?.calls || []).filter(textMatchesCall);
  if (!calls.length) {
    els.turnList.innerHTML = '<div class="detail-empty"><h2>No turns</h2><p>No matching model turns found.</p></div>';
    return;
  }
  const total = state.payload.calls.length;
  els.turnList.innerHTML = calls.map((call) => {
    const originalIndex = state.payload.calls.findIndex((item) => item.callId === call.callId);
    const title = `Turn ${total - originalIndex}`;
    const issueCount = call.issues?.length || 0;
    const preview = call.output?.content || call.output?.toolCalls?.map((tool) => `Tool: ${tool.name}`).join(', ') || call.finishReason || 'Pending response';
    return `
      <button class="turn-card ${call.callId === state.selectedCallId ? 'is-active' : ''}" type="button" data-call-id="${escapeHtml(call.callId)}">
        <span class="card-title">
          <strong>${title}</strong>
          ${issueCount ? `<span class="badge ${call.issues.some((item) => item.severity === 'error') ? 'badge--error' : 'badge--warning'}">${issueCount}</span>` : `<span class="badge">${escapeHtml(call.finishReason || 'pending')}</span>`}
        </span>
        <span class="card-meta">${escapeHtml(call.model || call.portId || 'model')} · ${formatDate(call.startedAt || call.completedAt)}</span>
        <span class="card-sub">${escapeHtml(preview)}</span>
      </button>
    `;
  }).join('');
}

function renderTextOrJson(text) {
  const raw = String(text || '');
  if (!raw.trim()) return '<p class="empty-line">No text content.</p>';
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return `<pre class="json-view">${escapeHtml(JSON.stringify(JSON.parse(trimmed), null, 2))}</pre>`;
    } catch {
      return `<div class="markdown">${renderMarkdown(raw)}</div>`;
    }
  }
  return `<div class="markdown">${renderMarkdown(raw)}</div>`;
}

function renderMessage(message) {
  const meta = [
    message.contentChars ? `${message.contentChars} chars` : '',
    message.truncated ? 'truncated' : '',
    message.redacted ? 'redacted' : '',
    message.toolCallId || '',
  ].filter(Boolean).join(' · ');
  const toolCalls = (message.toolCalls || []).map((tool) => `
    <div class="tool-box">
      <div class="tool-box__head"><strong>${escapeHtml(tool.name)}</strong><span class="card-meta">${escapeHtml(tool.id || '')}</span></div>
      <div class="tool-box__body">${renderTextOrJson(tool.arguments || '{}')}</div>
    </div>
  `).join('');
  return `
    <article class="message-block">
      <div class="message-block__head"><strong>${escapeHtml(message.role)}</strong><span class="card-meta">${escapeHtml(meta)}</span></div>
      <div class="message-block__body">${renderTextOrJson(message.content)}</div>
      ${toolCalls}
    </article>
  `;
}

function renderOutput(output) {
  if (!output) return '<p class="empty-line">No response recorded yet.</p>';
  const parts = [];
  if (output.error) {
    parts.push(`
      <article class="issue-box">
        <div class="issue-box__head"><strong>Provider Error</strong><span class="badge badge--error">error</span></div>
        <div class="issue-box__body"><pre class="json-view">${escapeHtml(JSON.stringify(output.error, null, 2))}</pre></div>
      </article>
    `);
  }
  parts.push(`
    <article class="message-block">
      <div class="message-block__head"><strong>assistant</strong><span class="card-meta">${output.contentChars || 0} chars${output.contentTruncated ? ' · truncated' : ''}</span></div>
      <div class="message-block__body">${renderTextOrJson(output.content)}</div>
    </article>
  `);
  if (output.toolCalls?.length) {
    parts.push(...output.toolCalls.map((tool) => `
      <article class="tool-box">
        <div class="tool-box__head"><strong>Tool call: ${escapeHtml(tool.name)}</strong><span class="card-meta">${escapeHtml(tool.id || `#${tool.index}`)}${tool.truncated ? ' · truncated' : ''}</span></div>
        <div class="tool-box__body">${renderTextOrJson(tool.arguments || '{}')}</div>
      </article>
    `));
  }
  if (output.reasoning) {
    parts.push(`
      <details class="message-block">
        <summary class="message-block__head"><strong>Reasoning</strong><span class="card-meta">${output.reasoningChars || output.reasoning.length} chars${output.reasoningTruncated ? ' · truncated' : ''}</span></summary>
        <div class="message-block__body">${renderTextOrJson(output.reasoning)}</div>
      </details>
    `);
  }
  return parts.join('');
}

function usageLabel(usage) {
  if (!usage) return '';
  return [
    typeof usage.inputTokens === 'number' ? `in ${usage.inputTokens}` : '',
    typeof usage.outputTokens === 'number' ? `out ${usage.outputTokens}` : '',
    typeof usage.totalTokens === 'number' ? `total ${usage.totalTokens}` : '',
  ].filter(Boolean).join(' / ');
}

function renderCallDetail() {
  const call = selectedCall();
  const file = selectedFile();
  const showTimeline = file?.type === 'session';
  els.detailEmpty.hidden = Boolean(call || showTimeline);
  els.detail.hidden = !call || showTimeline;
  els.timelineDetail.hidden = !showTimeline;
  if (showTimeline) {
    renderTimeline();
    return;
  }
  if (!call) return;
  const index = state.payload.calls.findIndex((item) => item.callId === call.callId);
  const turnName = `Turn ${state.payload.calls.length - index}`;
  els.detailEyebrow.textContent = call.callId;
  els.detailTitle.textContent = turnName;
  els.detailMeta.textContent = [
    call.model || call.portId || 'model',
    call.finishReason || 'pending',
    usageLabel(call.usage),
    call.runId || '',
  ].filter(Boolean).join(' · ');
  els.inputCount.textContent = `${call.messageCount || call.input.length} messages · ${call.toolCount || call.tools.length} tools`;
  els.outputCount.textContent = call.output ? `${call.output.contentChars || 0} chars · ${call.output.toolCalls?.length || 0} tool calls` : 'pending';
  const tools = call.tools?.length ? `
    <details class="tool-box" open>
      <summary class="tool-box__head"><strong>Tools Offered</strong><span class="card-meta">${call.tools.length}</span></summary>
      <div class="tool-box__body">${call.tools.map((tool) => `<p><strong>${escapeHtml(tool.name)}</strong><br><span class="card-meta">${escapeHtml(tool.description || '')}</span></p>`).join('')}</div>
    </details>
  ` : '';
  const callIssues = call.issues?.length ? `
    <article class="issue-box">
      <div class="issue-box__head"><strong>Bug Signals</strong><span class="badge badge--warning">${call.issues.length}</span></div>
      <div class="issue-box__body">${call.issues.map((item) => `<p>${issueBadge(item)} <strong>${escapeHtml(item.title)}</strong><br><span class="card-meta">${escapeHtml(item.detail || '')}</span></p>`).join('')}</div>
    </article>
  ` : '';
  els.inputContent.innerHTML = tools + call.input.map(renderMessage).join('');
  els.outputContent.innerHTML = callIssues + renderOutput(call.output);
  els.rawRequest.textContent = JSON.stringify(call.rawRequest || {}, null, 2);
  els.rawResponse.textContent = JSON.stringify(call.rawResponse || {}, null, 2);
  els.rawPanel.hidden = !state.rawOpen;
}

function renderTimeline() {
  const timeline = state.payload?.timeline || [];
  els.timelineMeta.textContent = selectedFile()?.name || 'Session events and diagnostics';
  if (!timeline.length) {
    els.timeline.innerHTML = '<div class="detail-empty"><h2>No session events</h2><p>This session file did not contain readable events.</p></div>';
    return;
  }
  els.timeline.innerHTML = timeline.map((event) => `
    <div class="timeline-row">
      <time>${escapeHtml(formatDate(event.at))}</time>
      <div>
        <strong>${escapeHtml(event.kind)}</strong>
        <p>${escapeHtml(event.summary)}</p>
      </div>
    </div>
  `).join('');
}

function render() {
  updateMetrics();
  renderFileList();
  renderIssues();
  renderTurnList();
  renderCallDetail();
}

async function loadFromServer(fileId = '') {
  state.clientFiles = null;
  const root = els.repoPath.value.trim() || state.root;
  const params = new URLSearchParams({ root });
  if (fileId) params.set('file', fileId);
  const response = await fetch(`/api/load?${params.toString()}`);
  if (!response.ok) throw new Error(`Load failed: ${response.status}`);
  const payload = await response.json();
  state.payload = payload;
  state.root = payload.root || root;
  state.selectedFileId = payload.selectedFileId || '';
  state.selectedCallId = payload.calls?.[0]?.callId || '';
  els.repoPath.value = state.root || root;
  render();
}

async function loadSelectedBrowserFile(fileId) {
  if (!state.clientFiles || !state.payload) return;
  state.payload = await loadBrowserFile(state.payload, fileId, state.clientFiles);
  state.selectedFileId = state.payload.selectedFileId || '';
  state.selectedCallId = state.payload.calls?.[0]?.callId || '';
  render();
}

async function bootstrap() {
  try {
    const response = await fetch('/api/default-root');
    const data = await response.json();
    state.root = data.root;
    els.repoPath.value = data.root;
    await loadFromServer();
  } catch (error) {
    setToast(error instanceof Error ? error.message : 'Could not load logs');
    render();
  }
}

els.loadPath.addEventListener('click', () => {
  loadFromServer().catch((error) => setToast(error.message));
});

els.repoPath.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    loadFromServer().catch((error) => setToast(error.message));
  }
});

els.refresh.addEventListener('click', () => {
  if (state.clientFiles) {
    setToast('Browser-selected folders cannot auto-refresh. Choose the folder again.');
    return;
  }
  loadFromServer(state.selectedFileId).catch((error) => setToast(error.message));
});

els.chooseFolder.addEventListener('click', () => {
  els.folderInput.click();
});

els.folderInput.addEventListener('change', async () => {
  const files = [...els.folderInput.files];
  if (!files.length) return;
  state.clientFiles = files;
  state.payload = await buildPayloadFromBrowserFiles(files);
  state.root = state.payload.rootLabel;
  state.selectedFileId = state.payload.selectedFileId || '';
  state.selectedCallId = state.payload.calls?.[0]?.callId || '';
  els.repoPath.value = state.payload.rootLabel;
  render();
});

els.fileList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-file-id]');
  if (!button) return;
  const fileId = button.dataset.fileId;
  state.selectedFileId = fileId;
  state.rawOpen = false;
  if (state.clientFiles) {
    loadSelectedBrowserFile(fileId);
  } else {
    loadFromServer(fileId).catch((error) => setToast(error.message));
  }
});

els.turnList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-call-id]');
  if (!button) return;
  state.selectedCallId = button.dataset.callId;
  render();
});

els.issuePanel.addEventListener('click', (event) => {
  const button = event.target.closest('[data-call-id]');
  const callId = button?.dataset.callId;
  if (!callId) return;
  state.selectedCallId = callId;
  render();
});

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((item) => item.classList.remove('is-active'));
    button.classList.add('is-active');
    state.filter = button.dataset.filter;
    renderFileList();
  });
});

els.search.addEventListener('input', () => {
  state.search = els.search.value;
  renderTurnList();
});

els.toggleRaw.addEventListener('click', () => {
  state.rawOpen = !state.rawOpen;
  renderCallDetail();
});

els.copySummary.addEventListener('click', async () => {
  const file = selectedFile();
  const call = selectedCall();
  const issues = state.payload?.issues || [];
  const callIssues = call?.issues?.length ? call.issues : issues.slice(0, 8);
  const summary = [
    `Mitii log bug summary`,
    `Repo: ${state.payload?.rootLabel || ''}`,
    `File: ${file?.name || ''}`,
    call ? `Call: ${call.callId}` : '',
    call ? `Model: ${call.model || call.portId || ''}` : '',
    call ? `Finish: ${call.finishReason || 'pending'}` : '',
    '',
    ...callIssues.map((item) => `- [${item.severity}] ${item.title}${item.detail ? `: ${item.detail}` : ''}`),
  ].filter((line, index) => index < 7 || line).join('\n');
  await navigator.clipboard.writeText(summary);
  setToast('Bug summary copied.');
});

bootstrap();
