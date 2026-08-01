import {
  DEFAULT_AUDIT_PREVIEW_CHARS,
  DEFAULT_MAX_OUTPUT_BYTES,
} from "../defaults";
import { redactSecrets } from "../policy";

export interface SanitizedOutput {
  text: string;
  truncated: boolean;
  redacted: boolean;
  bytesProduced: number;
}

export function sanitizeTextOutput(
  value: string,
  maxBytes: number = DEFAULT_MAX_OUTPUT_BYTES,
): SanitizedOutput {
  const { text: redactedText, redacted } = redactSecrets(value);
  const encoded = Buffer.from(redactedText, "utf8");
  if (encoded.byteLength <= maxBytes) {
    return {
      text: redactedText,
      truncated: false,
      redacted,
      bytesProduced: encoded.byteLength,
    };
  }

  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  const truncatedText =
    encoded.subarray(0, end).toString("utf8") +
    "\n…[truncated by tool-runtime]";

  return {
    text: truncatedText,
    truncated: true,
    redacted,
    bytesProduced: Buffer.byteLength(truncatedText, "utf8"),
  };
}

export function previewForAudit(
  value: unknown,
  maxChars: number = DEFAULT_AUDIT_PREVIEW_CHARS,
): string {
  let raw: string;
  if (typeof value === "string") {
    raw = value;
  } else {
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = String(value);
    }
  }
  const { text } = redactSecrets(raw);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

export function measureJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Buffer.byteLength(String(value), "utf8");
  }
}
