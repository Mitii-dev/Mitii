import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import type {
  McpClient,
  McpRoot,
  McpToolCallResult,
  McpToolDescriptor,
} from '../contracts/types.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  method?: string;
  params?: unknown;
}

/**
 * Minimal MCP stdio client (JSON-RPC + Content-Length framing).
 * Supports initialize (with roots capability), tools/list, tools/call,
 * and server-initiated roots/list.
 */
export class McpStdioClient implements McpClient {
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
  private readonly roots: McpRoot[];
  private readonly clientInfoName: string;

  constructor(options: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    serverLabel: string;
    /** Workspace folders advertised via MCP roots. */
    roots?: McpRoot[];
    clientInfoName?: string;
  }) {
    this.serverLabel = options.serverLabel;
    this.roots = options.roots ?? [];
    this.clientInfoName = options.clientInfoName ?? 'mitii-mcp';
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
    const capabilities: Record<string, unknown> = {};
    if (this.roots.length > 0) {
      capabilities.roots = { listChanged: true };
    }
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities,
      clientInfo: { name: this.clientInfoName, version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});
  }

  /** Notify servers that workspace roots changed. */
  notifyRootsListChanged(): void {
    if (this.roots.length === 0) return;
    this.notify('notifications/roots/list_changed', {});
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

  private respond(id: number | string, result: unknown): void {
    if (this.closed) return;
    this.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result,
      }),
    );
  }

  private respondError(
    id: number | string,
    code: number,
    message: string,
  ): void {
    if (this.closed) return;
    this.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code, message },
      }),
    );
  }

  private handleServerRequest(message: JsonRpcMessage): void {
    if (message.id === undefined || message.id === null || !message.method) {
      return;
    }
    if (message.method === 'roots/list') {
      this.respond(message.id, { roots: this.roots });
      return;
    }
    this.respondError(
      message.id,
      -32601,
      `Method not found: ${message.method}`,
    );
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
    this.buffer = Buffer.from(lines.pop() ?? '', 'utf8');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Content-Length')) continue;
      this.handleMessage(trimmed);
    }
  }

  private handleMessage(raw: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return;
    }

    if (
      message.method &&
      message.id !== undefined &&
      message.id !== null &&
      !this.pending.has(Number(message.id))
    ) {
      this.handleServerRequest(message);
      return;
    }

    if (message.id === undefined || message.id === null) {
      return;
    }
    const id = Number(message.id);
    const pending = this.pending.get(id);
    if (!pending) {
      if (message.method) {
        this.handleServerRequest(message);
      }
      return;
    }
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

/** Build file:// roots for a workspace folder. */
export function workspaceRootsFromPath(
  workspaceRoot: string,
  name = 'workspace',
): McpRoot[] {
  return [
    {
      uri: pathToFileURL(workspaceRoot).href,
      name,
    },
  ];
}

/** Convenience for servers that speak NDJSON (no Content-Length). */
export function createLineReader(child: ChildProcessWithoutNullStreams) {
  return createInterface({ input: child.stdout });
}
