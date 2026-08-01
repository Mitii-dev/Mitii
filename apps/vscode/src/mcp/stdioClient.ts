import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

/**
 * Minimal MCP stdio client (JSON-RPC + Content-Length framing).
 * Enough for initialize → tools/list → tools/call.
 */
export class McpStdioClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private closed = false;
  private readonly serverLabel: string;

  constructor(options: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    serverLabel: string;
  }) {
    this.serverLabel = options.serverLabel;
    this.child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });

    this.child.stderr.on('data', (_chunk: Buffer) => {
      // Keep stderr for debugging but don't fail the client on chatter.
    });

    this.child.on('error', (error) => {
      this.rejectAll(error);
    });

    this.child.on('exit', (code, signal) => {
      this.closed = true;
      this.rejectAll(
        new Error(
          `MCP server "${this.serverLabel}" exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
        ),
      );
    });
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mitii-vscode', version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});
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

  async callTool(
    name: string,
    args: unknown,
  ): Promise<{ content: unknown; isError?: boolean }> {
    const result = (await this.request('tools/call', {
      name,
      arguments: args && typeof args === 'object' ? args : {},
    })) as { content?: unknown; isError?: boolean };
    return {
      content: result.content ?? result,
      isError: Boolean(result.isError),
    };
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new Error(`MCP server "${this.serverLabel}" disposed`));
    try {
      this.child.kill();
    } catch {
      // ignore
    }
  }

  private notify(method: string, params: unknown): void {
    if (this.closed) return;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });
    this.write(payload);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new Error(`MCP server "${this.serverLabel}" is closed`),
      );
    }
    const id = this.nextId++;
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(JSON.stringify(message));
      // Soft timeout so a hung server cannot block client create forever.
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

  private write(payload: string): void {
    const body = Buffer.from(payload, 'utf8');
    const header = Buffer.from(
      `Content-Length: ${body.length}\r\n\r\n`,
      'utf8',
    );
    this.child.stdin.write(Buffer.concat([header, body]));
  }

  private drain(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Some servers emit newline-delimited JSON without Content-Length.
        this.drainLineMode();
        return;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      this.handleMessage(body);
    }
  }

  private drainLineMode(): void {
    const text = this.buffer.toString('utf8');
    const lines = text.split('\n');
    // Keep last partial line in buffer.
    this.buffer = Buffer.from(lines.pop() ?? '', 'utf8');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Content-Length')) continue;
      this.handleMessage(trimmed);
    }
  }

  private handleMessage(raw: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(raw) as JsonRpcResponse;
    } catch {
      return;
    }
    if (message.id === undefined || message.id === null) {
      return; // notification from server
    }
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

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

/** Convenience for servers that speak NDJSON (no Content-Length). Unused helper kept for tests. */
export function createLineReader(child: ChildProcessWithoutNullStreams) {
  return createInterface({ input: child.stdout });
}
