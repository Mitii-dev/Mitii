import type {
  McpClient,
  McpToolCallResult,
  McpToolDescriptor,
} from '../contracts/types.js';

interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

/**
 * MCP SSE client (legacy HTTP+SSE transport).
 *
 * Opens GET on `url` for the event stream, then POSTs JSON-RPC to the
 * `endpoint` event URL advertised by the server (or falls back to `url`).
 */
export class McpSseClient implements McpClient {
  private nextId = 1;
  private closed = false;
  private readonly serverLabel: string;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly clientInfoName: string;
  private readonly fetchImpl: typeof fetch;
  private abort?: AbortController;
  private postUrl: string;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(options: {
    url: string;
    headers?: Record<string, string>;
    serverLabel: string;
    clientInfoName?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.url = options.url;
    this.postUrl = options.url;
    this.headers = { ...(options.headers ?? {}) };
    this.serverLabel = options.serverLabel;
    this.clientInfoName = options.clientInfoName ?? 'mitii-mcp';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async initialize(): Promise<void> {
    this.abort = new AbortController();
    void this.openEventStream(this.abort.signal);
    // Give the SSE stream a moment to advertise the POST endpoint.
    await Promise.race([
      this.waitForEndpoint(2_000),
      new Promise((r) => setTimeout(r, 2_000)),
    ]);
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: this.clientInfoName, version: '1.0.0' },
    });
    await this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.request('tools/list', {})) as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };
    return (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} },
    }));
  }

  async callTool(name: string, args: unknown): Promise<McpToolCallResult> {
    const result = (await this.request('tools/call', {
      name,
      arguments: args && typeof args === 'object' ? args : {},
    })) as {
      content?: unknown;
      structuredContent?: unknown;
      isError?: boolean;
    };
    return {
      content: result.content ?? result,
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {}),
      isError: Boolean(result.isError),
    };
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort?.abort();
    this.rejectAll(new Error(`MCP SSE server "${this.serverLabel}" disposed`));
  }

  private waitForEndpoint(ms: number): Promise<void> {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (this.postUrl !== this.url || Date.now() - start >= ms) {
          resolve();
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  private async openEventStream(signal: AbortSignal): Promise<void> {
    const response = await this.fetchImpl(this.url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...this.headers,
      },
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(
        `MCP SSE connect failed (${response.status}) for "${this.serverLabel}"`,
      );
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = 'message';
    let dataLines: string[] = [];

    const flush = () => {
      if (dataLines.length === 0) {
        eventName = 'message';
        return;
      }
      const data = dataLines.join('\n');
      dataLines = [];
      const name = eventName;
      eventName = 'message';
      if (name === 'endpoint') {
        try {
          this.postUrl = new URL(data, this.url).toString();
        } catch {
          this.postUrl = data;
        }
        return;
      }
      this.handleSseData(data);
    };

    while (!this.closed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') {
          flush();
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
  }

  private handleSseData(data: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(data) as JsonRpcMessage;
    } catch {
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const id = Number(message.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (message.error) {
      pending.reject(
        new Error(
          `MCP error ${message.error.code}: ${message.error.message}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private async notify(method: string, params: unknown): Promise<void> {
    if (this.closed) return;
    await this.fetchImpl(this.postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new Error(`MCP SSE server "${this.serverLabel}" is closed`),
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      void this.fetchImpl(this.postUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...this.headers,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params,
        }),
      })
        .then(async (response) => {
          // Some SSE servers answer POSTs with JSON directly.
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('application/json')) {
            const body = (await response.json()) as JsonRpcMessage;
            if (this.pending.has(id)) {
              this.pending.delete(id);
              if (body.error) {
                reject(
                  new Error(
                    `MCP error ${body.error.code}: ${body.error.message}`,
                  ),
                );
                return;
              }
              resolve(body.result);
            }
          }
          if (!response.ok) {
            if (this.pending.has(id)) {
              this.pending.delete(id);
              reject(
                new Error(
                  `MCP SSE POST failed (${response.status}) for ${method}`,
                ),
              );
            }
          }
        })
        .catch((error: unknown) => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(
          new Error(
            `MCP request timed out: ${method} on "${this.serverLabel}"`,
          ),
        );
      }, 45_000);
    });
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
