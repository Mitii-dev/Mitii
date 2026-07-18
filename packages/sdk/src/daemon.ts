import type { MitiiApprovalDecision, MitiiApprovalMode, MitiiEvent, MitiiMode, MitiiRuntime } from './types';

export interface DaemonClientOptions {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  trace?: (event: DaemonTraceEvent) => void;
}

export interface DaemonTraceEvent {
  direction: 'send' | 'receive' | 'error';
  transport: 'http' | 'sse';
  method?: string;
  path: string;
  status?: number;
  durationMs?: number;
  eventId?: number;
  eventType?: string;
  error?: string;
  payload?: unknown;
}

export interface DaemonSessionCreateOptions {
  cwd: string;
  mode?: MitiiMode;
  approval?: MitiiApprovalMode;
  providerType?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  runtime?: MitiiRuntime;
  indexWorkspace?: boolean;
}

export interface DaemonSessionInfo {
  id: string;
  cwd: string;
  mode: MitiiMode;
  approval: MitiiApprovalMode;
  createdAt: number;
  updatedAt: number;
  running: boolean;
  closed: boolean;
}

export interface DaemonPromptInput {
  mode?: MitiiMode;
  message: string;
  attachments?: unknown[];
}

export class DaemonClient {
  readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly trace?: (event: DaemonTraceEvent) => void;

  constructor(options: DaemonClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:4310').replace(/\/$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? fetch;
    this.trace = options.trace;
  }

  health(): Promise<Record<string, unknown>> {
    return this.request('GET', '/health');
  }

  capabilities(): Promise<Record<string, unknown>> {
    return this.request('GET', '/capabilities');
  }

  async createSession(options: DaemonSessionCreateOptions): Promise<DaemonSessionInfo> {
    const body = await this.request<{ session: DaemonSessionInfo }>('POST', '/session', options);
    return body.session;
  }

  async listSessions(): Promise<DaemonSessionInfo[]> {
    const body = await this.request<{ sessions: DaemonSessionInfo[] }>('GET', '/sessions');
    return body.sessions;
  }

  async getSession(id: string): Promise<DaemonSessionInfo> {
    const body = await this.request<{ session: DaemonSessionInfo }>('GET', `/session/${encodeURIComponent(id)}`);
    return body.session;
  }

  closeSession(id: string): Promise<Record<string, unknown>> {
    return this.request('DELETE', `/session/${encodeURIComponent(id)}`);
  }

  prompt(id: string, input: DaemonPromptInput): Promise<Record<string, unknown>> {
    return this.request('POST', `/session/${encodeURIComponent(id)}/prompt`, input);
  }

  cancel(id: string): Promise<Record<string, unknown>> {
    return this.request('POST', `/session/${encodeURIComponent(id)}/cancel`);
  }

  respondToPermission(id: string, approvalId: string, decision: MitiiApprovalDecision): Promise<Record<string, unknown>> {
    return this.request('POST', `/session/${encodeURIComponent(id)}/permissions/${encodeURIComponent(approvalId)}/respond`, { decision });
  }

  events(id: string, lastSeenEventId?: number): AsyncIterable<ParsedSseEvent<MitiiEvent>> {
    const headers: Record<string, string> = this.headers();
    if (lastSeenEventId) headers['last-event-id'] = String(lastSeenEventId);
    const path = `/session/${encodeURIComponent(id)}/events`;
    const startedAt = Date.now();
    this.emitTrace({ direction: 'send', transport: 'sse', method: 'GET', path });
    return parseSseStream<MitiiEvent>(
      this.fetchImpl(`${this.baseUrl}${path}`, { headers }),
      (event) => this.emitTrace({
        direction: 'receive',
        transport: 'sse',
        path,
        durationMs: Date.now() - startedAt,
        eventId: event.id,
        eventType: event.event,
        payload: event.data,
      })
    );
  }

  private async request<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    this.emitTrace({ direction: 'send', transport: 'http', method, path, payload: body });
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...this.headers(),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : {};
      this.emitTrace({
        direction: 'receive',
        transport: 'http',
        method,
        path,
        status: res.status,
        durationMs: Date.now() - startedAt,
        payload: parsed,
      });
      if (!res.ok) {
        const message = parsed?.error?.message ?? `${method} ${path} failed with ${res.status}`;
        throw new Error(message);
      }
      return parsed as T;
    } catch (error) {
      this.emitTrace({
        direction: 'error',
        transport: 'http',
        method,
        path,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private emitTrace(event: DaemonTraceEvent): void {
    try {
      this.trace?.(event);
    } catch {
      // Debug tracing must never affect daemon requests.
    }
  }

  private headers(): Record<string, string> {
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }
}

export class DaemonSessionClient {
  lastSeenEventId = 0;

  constructor(readonly client: DaemonClient, readonly session: DaemonSessionInfo) {}

  static async createOrAttach(client: DaemonClient, options: DaemonSessionCreateOptions): Promise<DaemonSessionClient> {
    const existing = (await client.listSessions()).find((session) => session.cwd === options.cwd && !session.closed);
    return new DaemonSessionClient(client, existing ?? await client.createSession(options));
  }

  prompt(input: DaemonPromptInput): Promise<Record<string, unknown>> {
    return this.client.prompt(this.session.id, input);
  }

  cancel(): Promise<Record<string, unknown>> {
    return this.client.cancel(this.session.id);
  }

  respondToPermission(id: string, decision: MitiiApprovalDecision): Promise<Record<string, unknown>> {
    return this.client.respondToPermission(this.session.id, id, decision);
  }

  async *events(): AsyncIterable<MitiiEvent> {
    for await (const event of this.client.events(this.session.id, this.lastSeenEventId)) {
      this.lastSeenEventId = event.id;
      yield event.data;
    }
  }
}

export interface ParsedSseEvent<T> {
  id: number;
  event?: string;
  data: T;
}

export async function* parseSseStream<T>(
  responsePromise: Promise<Response>,
  onEvent?: (event: ParsedSseEvent<T>) => void
): AsyncIterable<ParsedSseEvent<T>> {
  const response = await responsePromise;
  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = findFrameBoundary(buffer);
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary);
        const skip = buffer.slice(boundary, boundary + 4).startsWith('\r\n\r\n') ? 4 : 2;
        buffer = buffer.slice(boundary + skip);
        const parsed = parseSseFrame<T>(raw);
        if (parsed) {
          onEvent?.(parsed);
          yield parsed;
        }
        boundary = findFrameBoundary(buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame<T>(frame: string): ParsedSseEvent<T> | null {
  let id = 0;
  let event: string | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const index = line.indexOf(':');
    const field = index >= 0 ? line.slice(0, index) : line;
    const value = index >= 0 ? line.slice(index + 1).replace(/^ /, '') : '';
    if (field === 'id') id = Number(value);
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { id, event, data: JSON.parse(data.join('\n')) as T };
}

function findFrameBoundary(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}
