#!/usr/bin/env node
/**
 * Minimal fake LSP stdio server for host integration tests.
 * Speaks Content-Length framing and answers initialize + definition/hover.
 */
import { createInterface } from "node:readline";

let buffer = Buffer.alloc(0);

function write(message) {
  const json = JSON.stringify(message);
  const frame = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
  process.stdout.write(frame);
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = Buffer.alloc(0);
      return;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      continue;
    }
    handle(message);
  }
});

function handle(message) {
  if (message.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        capabilities: {
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          typeDefinitionProvider: true,
          documentSymbolProvider: true,
          workspaceSymbolProvider: true,
          implementationProvider: true,
        },
      },
    });
    return;
  }
  if (message.method === "initialized" || message.method === "textDocument/didOpen") {
    return;
  }
  if (message.method === "shutdown") {
    write({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "exit") {
    process.exit(0);
  }
  if (message.method === "textDocument/definition") {
    const uri = message.params?.textDocument?.uri ?? "file:///tmp/x.py";
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: [
        {
          uri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
        },
      ],
    });
    return;
  }
  if (message.method === "textDocument/hover") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        contents: { kind: "markdown", value: "fake hover" },
      },
    });
    return;
  }
  if (typeof message.id !== "undefined") {
    write({ jsonrpc: "2.0", id: message.id, result: null });
  }
}

// Keep process alive on empty stdin EOF in some runners.
createInterface({ input: process.stdin });
