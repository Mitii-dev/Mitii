import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";
import type { ToolResult } from "../../tool-runtime";

import {
  extractToolContentPaths,
  normalizeRepoPath,
  stripPathRangeSuffix,
  toolContentPathsOverlap,
} from "../actions/extractToolContentPaths";

const LEDGER_READ_TOOLS = new Set(["read_file", "read_many_files"]);

export interface ReadLedgerEntry {
  key: string;
  paths: string[];
  toolName: string;
  preview: string;
  recordedAtMs: number;
}

/**
 * Main-loop duplicate-read protection. Discovery has a similar guard; this
 * ledger covers execute/repair so unchanged paths return a compact stub
 * instead of appending another full file body to the transcript.
 */
export class ReadLedger {
  private readonly entries = new Map<string, ReadLedgerEntry>();

  public static isLedgerTool(toolName: string): boolean {
    return LEDGER_READ_TOOLS.has(toolName);
  }

  public record(params: {
    toolName: string;
    argumentsValue: unknown;
    preview?: string;
    nowMs?: number;
  }): void {
    if (!ReadLedger.isLedgerTool(params.toolName)) {
      return;
    }
    const key = ledgerKey(params.toolName, params.argumentsValue);
    if (!key) {
      return;
    }
    const paths = extractToolContentPaths(
      params.toolName,
      params.argumentsValue,
    );
    this.entries.set(key, {
      key,
      paths,
      toolName: params.toolName,
      preview: clipPreview(params.preview ?? ""),
      recordedAtMs: params.nowMs ?? Date.now(),
    });
  }

  public lookup(params: {
    toolName: string;
    argumentsValue: unknown;
  }): ReadLedgerEntry | undefined {
    if (!ReadLedger.isLedgerTool(params.toolName)) {
      return undefined;
    }
    const key = ledgerKey(params.toolName, params.argumentsValue);
    if (!key) {
      return undefined;
    }
    return this.entries.get(key);
  }

  public invalidatePaths(changedFiles: readonly string[]): number {
    if (changedFiles.length === 0) {
      return 0;
    }
    let removed = 0;
    for (const [key, entry] of [...this.entries.entries()]) {
      if (toolContentPathsOverlap(entry.paths, changedFiles)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }

  public snapshot(): ReadLedgerEntry[] {
    return [...this.entries.values()];
  }
}

export function buildAlreadyReadToolResult(params: {
  callId: string;
  toolName: string;
  entry: ReadLedgerEntry;
  nowIso: string;
}): ToolResult {
  const pathLabel =
    params.entry.paths.map(stripPathRangeSuffix).join(", ") || "file";
  const message = [
    `Already read (${pathLabel}).`,
    "Content is unchanged since the prior successful read in this run.",
    "Do not re-read unless you need a different line range (startLine/endLine) or the file was mutated.",
    params.entry.preview ? `Prior preview: ${params.entry.preview}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    callId: params.callId,
    toolName: params.toolName,
    status: "succeeded",
    reasonCode: "already_read",
    truncated: false,
    redacted: false,
    durationMs: 0,
    bytesProduced: message.length,
    warnings: [],
    output: {
      alreadyRead: true,
      paths: params.entry.paths,
      message,
      preview: params.entry.preview || undefined,
    },
    audit: {
      callId: params.callId,
      toolName: params.toolName,
      startedAt: params.nowIso,
      endedAt: params.nowIso,
      status: "succeeded",
      reasonCode: "already_read",
      inputPreview: params.toolName,
      outputPreview: message.slice(0, 240),
      bytesProduced: message.length,
      durationMs: 0,
      truncated: false,
      redacted: false,
    },
  };
}

function ledgerKey(
  toolName: string,
  argumentsValue: unknown,
): string | undefined {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return undefined;
  }
  const record = argumentsValue as Record<string, unknown>;
  if (typeof record.path === "string" && record.path.trim().length > 0) {
    const path = normalizeRepoPath(record.path);
    const start =
      typeof record.startLine === "number" ? record.startLine : undefined;
    const end = typeof record.endLine === "number" ? record.endLine : undefined;
    return `${toolName}|${path}|${start ?? ""}|${end ?? ""}`;
  }
  if (Array.isArray(record.paths) && record.paths.length > 0) {
    const paths = record.paths
      .filter(
        (path): path is string =>
          typeof path === "string" && path.trim().length > 0,
      )
      .map(normalizeRepoPath)
      .sort();
    if (paths.length === 0) {
      return undefined;
    }
    return `${toolName}|${paths.join(",")}`;
  }
  return undefined;
}

function clipPreview(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 180) {
    return collapsed;
  }
  return `${collapsed.slice(0, 179).trimEnd()}…`;
}
