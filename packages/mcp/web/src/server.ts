/**
 * Minimal MCP stdio server (JSON-RPC + Content-Length framing).
 */

import { handleToolCall, listToolDefinitions } from './tools.js';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function runMcpWebServer(): Promise<void> {
  let buffer = Buffer.alloc(0);

  const respond = (message: Record<string, unknown>) => {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(
      `Content-Length: ${payload.length}\r\n\r\n`,
      'utf8',
    );
    process.stdout.write(Buffer.concat([header, payload]));
  };

  const handle = async (raw: string) => {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return;
    }
    if (!message.method) return;

    if (message.method === 'initialize') {
      respond({
        jsonrpc: '2.0',
        id: message.id ?? null,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mitii-mcp-web', version: '2.9.39' },
        },
      });
      return;
    }

    if (message.method === 'notifications/initialized') {
      return;
    }

    if (message.method === 'tools/list') {
      respond({
        jsonrpc: '2.0',
        id: message.id ?? null,
        result: { tools: listToolDefinitions() },
      });
      return;
    }

    if (message.method === 'tools/call') {
      const params = (message.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const name = typeof params.name === 'string' ? params.name : '';
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? params.arguments
          : {};
      const result = await handleToolCall(name, args);
      respond({
        jsonrpc: '2.0',
        id: message.id ?? null,
        result,
      });
      return;
    }

    if (message.method === 'ping') {
      respond({ jsonrpc: '2.0', id: message.id ?? null, result: {} });
      return;
    }

    if (message.id !== undefined && message.id !== null) {
      respond({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      });
    }
  };

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        // Also accept NDJSON for local smoke.
        const text = buffer.toString('utf8');
        if (!text.includes('\n')) return;
        const lines = text.split('\n');
        buffer = Buffer.from(lines.pop() ?? '', 'utf8');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) void handle(trimmed);
        }
        return;
      }
      const header = buffer.subarray(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const body = buffer.subarray(start, start + length).toString('utf8');
      buffer = buffer.subarray(start + length);
      void handle(body);
    }
  });

  process.stdin.resume();
}
