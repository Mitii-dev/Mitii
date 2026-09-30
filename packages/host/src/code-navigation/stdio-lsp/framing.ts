/**
 * LSP Content-Length framing (OpenClaw / LSP stdio transport).
 * Processes fragmented stdout with geometric buffer growth and less copying.
 */

export const LSP_HEADER_SEPARATOR = Buffer.from("\r\n\r\n", "ascii");
export const MAX_LSP_HEADER_BYTES = 8 * 1024;
export const MAX_LSP_BODY_BYTES = 64 * 1024 * 1024;

export class LspFramingError extends Error {
  override readonly name = "LspFramingError";
  constructor(detail: string) {
    super(`LSP framing error: ${detail}`);
  }
}

export type LspInputBuffer = {
  buffer: Buffer;
  length: number;
  body?: { start: number; end: number };
};

export function createLspInputBuffer(): LspInputBuffer {
  return { buffer: Buffer.alloc(0), length: 0 };
}

export function encodeLspMessage(body: unknown): Buffer {
  const json = JSON.stringify(body);
  const header = `Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n`;
  return Buffer.from(header + json, "utf-8");
}

type LspParseResult =
  | { readonly ok: true; readonly messages: unknown[]; readonly consumed: number }
  | {
      readonly ok: false;
      readonly messages: unknown[];
      readonly error: LspFramingError;
      readonly consumed: number;
    };

function parseContentLength(header: string): number | LspFramingError {
  const values: string[] = [];
  for (const line of header.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      return new LspFramingError("header line must contain a colon");
    }
    if (line.slice(0, separator).trim().toLowerCase() === "content-length") {
      values.push(line.slice(separator + 1).trim());
    }
  }
  if (values.length !== 1) {
    return new LspFramingError(
      `expected exactly one Content-Length header, received ${values.length}`,
    );
  }
  const value = values[0]!;
  if (!/^[0-9]+$/.test(value)) {
    return new LspFramingError("Content-Length must be decimal digits");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length <= 0) {
    return new LspFramingError("Content-Length must be a positive safe integer");
  }
  if (length > MAX_LSP_BODY_BYTES) {
    return new LspFramingError(`Content-Length exceeds ${MAX_LSP_BODY_BYTES} bytes`);
  }
  return length;
}

export function parseLspMessages(input: LspInputBuffer): LspParseResult {
  const messages: unknown[] = [];
  let consumed = 0;

  while (true) {
    if (!input.body) {
      const remaining = input.buffer.subarray(consumed, input.length);
      const headerEnd = remaining.indexOf(LSP_HEADER_SEPARATOR);
      if (headerEnd === -1) {
        const maxIncomplete =
          MAX_LSP_HEADER_BYTES + LSP_HEADER_SEPARATOR.length - 1;
        return remaining.length > maxIncomplete
          ? {
              ok: false,
              messages,
              error: new LspFramingError(
                `header exceeds ${MAX_LSP_HEADER_BYTES} bytes`,
              ),
              consumed,
            }
          : { ok: true, messages, consumed };
      }
      if (headerEnd > MAX_LSP_HEADER_BYTES) {
        return {
          ok: false,
          messages,
          error: new LspFramingError(
            `header exceeds ${MAX_LSP_HEADER_BYTES} bytes`,
          ),
          consumed,
        };
      }
      const contentLength = parseContentLength(
        remaining.subarray(0, headerEnd).toString("ascii"),
      );
      if (contentLength instanceof LspFramingError) {
        return { ok: false, messages, error: contentLength, consumed };
      }
      const start = consumed + headerEnd + LSP_HEADER_SEPARATOR.length;
      input.body = { start, end: start + contentLength };
    }
    if (input.length < input.body.end) {
      return { ok: true, messages, consumed };
    }
    let body: string;
    try {
      body = input.buffer.subarray(input.body.start, input.body.end).toString("utf-8");
    } catch {
      return {
        ok: false,
        messages,
        error: new LspFramingError("body is not valid UTF-8"),
        consumed,
      };
    }
    try {
      messages.push(JSON.parse(body));
    } catch (error) {
      return {
        ok: false,
        messages,
        error: new LspFramingError(
          `body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        ),
        consumed,
      };
    }
    consumed = input.body.end;
    input.body = undefined;
  }
}

/** Append a stdout chunk and extract complete framed messages. */
export function appendLspChunk(
  input: LspInputBuffer,
  chunk: Buffer | string,
): LspParseResult {
  const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
  const length = input.length + bytes.length;
  if (length > input.buffer.length) {
    const capacity = Math.max(
      length,
      Math.min(
        Math.max(4096, input.buffer.length * 2 || 4096),
        MAX_LSP_HEADER_BYTES + LSP_HEADER_SEPARATOR.length + MAX_LSP_BODY_BYTES,
      ),
    );
    const buffer = Buffer.allocUnsafe(capacity);
    if (input.length > 0) {
      input.buffer.copy(buffer, 0, 0, input.length);
    }
    input.buffer = buffer;
  }
  bytes.copy(input.buffer, input.length);
  input.length = length;

  const parsed = parseLspMessages(input);
  if (!parsed.ok || parsed.consumed === input.length) {
    input.buffer = Buffer.alloc(0);
    input.length = 0;
    input.body = undefined;
    return parsed;
  }
  if (parsed.consumed > 0) {
    input.buffer = Buffer.from(
      input.buffer.subarray(parsed.consumed, input.length),
    );
    input.length -= parsed.consumed;
    if (input.body) {
      input.body.start -= parsed.consumed;
      input.body.end -= parsed.consumed;
    }
  }
  return parsed;
}
