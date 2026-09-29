/**
 * Bound tool output for the model context; optionally spill the full payload.
 * Head/tail preview (Cline-style) with UTF-8 byte budgets (OpenCode/Codex pattern).
 */
import type { ToolOutputSpillPort } from "../../contracts/ports/ToolOutputSpillPort";
import { measureJsonBytes } from "../OutputSanitizer";

export const BOUNDED_OUTPUT_MARKER =
  "…[truncated by tool-runtime; full output spilled when spillId is set]…";

export interface BoundToolOutputParams {
  output: unknown;
  maxBytes: number;
  callId: string;
  toolName: string;
  spill?: ToolOutputSpillPort;
}

export interface BoundToolOutputResult {
  output: unknown;
  truncated: boolean;
  spilled: boolean;
  spillId?: string;
  warnings: string[];
  originalBytes: number;
  previewBytes: number;
}

export interface MitiiBoundedToolOutput {
  _mitiiBounded: true;
  originalBytes: number;
  previewBytes: number;
  spillId?: string;
  spillLocation?: string;
  preview: string;
}

export function isMitiiBoundedToolOutput(
  value: unknown,
): value is MitiiBoundedToolOutput {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as MitiiBoundedToolOutput)._mitiiBounded === true
  );
}

export async function boundToolOutput(
  params: BoundToolOutputParams,
): Promise<BoundToolOutputResult> {
  const { output, maxBytes, callId, toolName, spill } = params;
  if (output === undefined) {
    return {
      output,
      truncated: false,
      spilled: false,
      warnings: [],
      originalBytes: 0,
      previewBytes: 0,
    };
  }

  const originalBytes = measureJsonBytes(output);
  if (originalBytes <= maxBytes) {
    return {
      output,
      truncated: false,
      spilled: false,
      warnings: [],
      originalBytes,
      previewBytes: originalBytes,
    };
  }

  const fullPayload = serializeOutput(output);
  let spillId: string | undefined;
  let spillLocation: string | undefined;
  const warnings: string[] = [];

  if (spill) {
    try {
      const stored = await spill.store({
        callId,
        toolName,
        payload: fullPayload,
      });
      spillId = stored.spillId;
      spillLocation = stored.location;
      warnings.push(
        `Full tool output spilled (${originalBytes} bytes)${
          spillLocation ? ` at ${spillLocation}` : ` as ${spillId}`
        }.`,
      );
    } catch (error) {
      warnings.push(
        `Tool output spill failed: ${
          error instanceof Error ? error.message : String(error)
        }. Returning bounded preview only.`,
      );
    }
  } else {
    warnings.push(
      `Tool output exceeded ${maxBytes} bytes (${originalBytes}); truncated without spill store.`,
    );
  }

  const preview = headTailPreview(fullPayload, maxBytes);
  const bounded: MitiiBoundedToolOutput = {
    _mitiiBounded: true,
    originalBytes,
    previewBytes: Buffer.byteLength(preview, "utf8"),
    preview,
    ...(spillId ? { spillId } : {}),
    ...(spillLocation ? { spillLocation } : {}),
  };

  return {
    output: bounded,
    truncated: true,
    spilled: spillId !== undefined,
    spillId,
    warnings,
    originalBytes,
    previewBytes: bounded.previewBytes,
  };
}

function serializeOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/** Keep head + tail within maxBytes, UTF-8 safe. */
export function headTailPreview(text: string, maxBytes: number): string {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.byteLength <= maxBytes) {
    return text;
  }

  const marker = `\n${BOUNDED_OUTPUT_MARKER}\n`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (maxBytes <= markerBytes + 8) {
    return takePrefixUtf8(encoded, maxBytes);
  }

  const budget = maxBytes - markerBytes;
  const headBytes = Math.ceil(budget / 2);
  const tailBytes = Math.floor(budget / 2);
  const head = takePrefixUtf8(encoded, headBytes);
  const tail = takeSuffixUtf8(encoded, tailBytes);
  return `${head}${marker}${tail}`;
}

function takePrefixUtf8(encoded: Buffer, maxBytes: number): string {
  let end = Math.min(maxBytes, encoded.byteLength);
  while (end > 0 && (encoded[end - 1]! & 0xc0) === 0x80) {
    end -= 1;
  }
  return encoded.subarray(0, end).toString("utf8");
}

function takeSuffixUtf8(encoded: Buffer, maxBytes: number): string {
  let start = Math.max(0, encoded.byteLength - maxBytes);
  while (start < encoded.byteLength && (encoded[start]! & 0xc0) === 0x80) {
    start += 1;
  }
  return encoded.subarray(start).toString("utf8");
}
