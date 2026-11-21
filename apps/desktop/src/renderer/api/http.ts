/** Shared HTTP helpers (auth headers, NDJSON streaming). */

import {
  parseDesktopStreamLine,
  type DesktopPromptStreamLine,
} from '../../shared/protocol.js';

export function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

export function decodeStreamLine(text: string): DesktopPromptStreamLine {
  const parsed = parseDesktopStreamLine(text);
  if (parsed.ok) return parsed.value;
  const detail = parsed.issues.map((i) => i.message).join('; ');
  throw new Error(`stream_invalid_line:${parsed.reason}${detail ? `:${detail}` : ''}`);
}

export async function* streamNdjson(
  url: string,
  init: RequestInit,
): AsyncGenerator<DesktopPromptStreamLine> {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`stream_${res.status}:${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          yield decodeStreamLine(line);
        }
        newline = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail) {
      yield decodeStreamLine(tail);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    throw error;
  }
}
