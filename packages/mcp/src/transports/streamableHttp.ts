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
 * MCP streamable-HTTP client (single endpoint POST).
 *
 * Posts JSON-RPC to `url`. Accepts either a JSON response body or a
 * text/event-stream body and resolves the matching request id.
 */
export class McpStreamableHttpClient implements McpClient {
  private nextId = 1;
  private closed = false;
  private sessionId?: string;
  private readonly serverLabel: string;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly clientInfoName: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    url: string;
    headers?: Record<string, string>;
    serverLabel: string;
    clientInfoName?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.url = options.url;
    this.headers = { ...(options.headers ?? {}) };
    this.serverLabel = options.serverLabel;
    this.clientInfoName = options.clientInfoName ?? 'mitii-mcp';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: this.clientInfoName, version: '1.0.0' },
    });
    await this.requestNotify('notifications/initialized', {});
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.request('tools/list', {})) as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
      }>;
    };
    return (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} },
      ...(tool._meta ? { _meta: tool._meta } : {}),
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
      _meta?: Record<string, unknown>;
    };
    return {
      content: result.content ?? result,
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {}),
      isError: Boolean(result.isError),
      ...(result._meta ? { _meta: result._meta } : {}),
    };
  }

  async readResource(
    uri: string,
  ): Promise<{ contents: import('../contracts/types.js').McpResourceContents[] }> {
    const result = (await this.request('resources/read', { uri })) as {
      contents?: Array<{
        uri?: string;
        mimeType?: string;
        text?: string;
        blob?: string;
        _meta?: Record<string, unknown>;
      }>;
    };
    return {
      contents: (result.contents ?? []).map((entry) => ({
        uri: entry.uri ?? uri,
        ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
        ...(entry.text !== undefined ? { text: entry.text } : {}),
        ...(entry.blob !== undefined ? { blob: entry.blob } : {}),
        ...(entry._meta ? { _meta: entry._meta } : {}),
      })),
    };
  }

  dispose(): void {
    this.closed = true;
  }

  private buildHeaders(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: accept,
      ...this.headers,
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }
    return headers;
  }

  private async requestNotify(
    method: string,
    params: unknown,
  ): Promise<void> {
    if (this.closed) return;
    await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.buildHeaders('application/json, text/event-stream'),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    });
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      throw new Error(
        `MCP streamable-HTTP server "${this.serverLabel}" is closed`,
      );
    }
    const id = this.nextId++;
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.buildHeaders('application/json, text/event-stream'),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }),
    });

    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;

    if (!response.ok) {
      throw new Error(
        `MCP streamable-HTTP ${method} failed (${response.status}) on "${this.serverLabel}"`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream') && response.body) {
      return this.readSseResult(response.body, id);
    }

    const body = (await response.json()) as JsonRpcMessage;
    if (body.error) {
      throw new Error(
        `MCP error ${body.error.code}: ${body.error.message}`,
      );
    }
    return body.result;
  }

  private async readSseResult(
    body: ReadableStream<Uint8Array>,
    expectId: number,
  ): Promise<unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines: string[] = [];

    const tryParse = (data: string): unknown | undefined => {
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(data) as JsonRpcMessage;
      } catch {
        return undefined;
      }
      if (message.id === undefined || message.id === null) return undefined;
      if (Number(message.id) !== expectId) return undefined;
      if (message.error) {
        throw new Error(
          `MCP error ${message.error.code}: ${message.error.message}`,
        );
      }
      return message.result;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') {
          if (dataLines.length > 0) {
            const result = tryParse(dataLines.join('\n'));
            dataLines = [];
            if (result !== undefined) return result;
          }
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    throw new Error(
      `MCP streamable-HTTP: no result for id=${expectId} on "${this.serverLabel}"`,
    );
  }
}
