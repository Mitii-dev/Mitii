import { describe, expect, it } from "vitest";

import {
  LspFramingError,
  appendLspChunk,
  createLspInputBuffer,
  encodeLspMessage,
} from "./framing.js";

describe("stdio LSP framing", () => {
  it("encodes Content-Length frames", () => {
    const encoded = encodeLspMessage({ jsonrpc: "2.0", id: 1, result: null });
    const text = encoded.toString("utf8");
    expect(text).toMatch(/^Content-Length: \d+\r\n\r\n/);
    expect(text).toContain('"id":1');
  });

  it("parses fragmented stdout chunks", () => {
    const payload = encodeLspMessage({
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
    const input = createLspInputBuffer();
    const mid = Math.floor(payload.length / 2);
    const first = appendLspChunk(input, payload.subarray(0, mid));
    expect(first.ok).toBe(true);
    expect(first.messages).toHaveLength(0);
    const second = appendLspChunk(input, payload.subarray(mid));
    expect(second.ok).toBe(true);
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("rejects oversized headers", () => {
    const input = createLspInputBuffer();
    const huge = Buffer.from(`Content-Length: 1\r\n${"x".repeat(9000)}\r\n\r\n{}`);
    const parsed = appendLspChunk(input, huge);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toBeInstanceOf(LspFramingError);
    }
  });
});
