import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { VerificationDiagnostic } from "../../../modules/verification";

const DEFAULT_MAX_BYTES = 256_000;
const DEFAULT_LINE_CHARS = 160;

/**
 * Load one source line per diagnostic for repair packaging. Soft-fail: missing
 * files or oversize reads are skipped so repair still proceeds.
 */
export async function loadDiagnosticSourceLines(params: {
  workspaceRoot: string;
  diagnostics: readonly VerificationDiagnostic[];
  maxFileBytes?: number;
  maxLineChars?: number;
}): Promise<ReadonlyMap<string, string>> {
  const root = params.workspaceRoot.trim();
  if (!root) {
    return new Map();
  }

  const maxBytes = params.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const maxLineChars = params.maxLineChars ?? DEFAULT_LINE_CHARS;
  const byPath = new Map<string, Set<number>>();

  for (const diagnostic of params.diagnostics) {
    if (!diagnostic.startLine || diagnostic.startLine < 1) {
      continue;
    }
    if (diagnostic.path === "<test>") {
      continue;
    }
    const lines = byPath.get(diagnostic.path) ?? new Set<number>();
    lines.add(diagnostic.startLine);
    byPath.set(diagnostic.path, lines);
  }

  const result = new Map<string, string>();
  for (const [relativePath, lineNumbers] of byPath) {
    const absolute = isAbsolute(relativePath)
      ? relativePath
      : join(root, relativePath);
    let content: string;
    try {
      content = await readFile(absolute, { encoding: "utf8" });
    } catch {
      continue;
    }
    if (Buffer.byteLength(content, "utf8") > maxBytes) {
      continue;
    }
    const fileLines = content.split(/\r?\n/);
    for (const lineNumber of lineNumbers) {
      const raw = fileLines[lineNumber - 1];
      if (raw === undefined) {
        continue;
      }
      const clipped = raw.replace(/\t/g, " ").trimEnd().slice(0, maxLineChars);
      if (clipped.length === 0) {
        continue;
      }
      result.set(diagnosticSourceLineKey(relativePath, lineNumber), clipped);
    }
  }

  return result;
}

export function diagnosticSourceLineKey(
  path: string,
  startLine: number,
): string {
  return `${path.replace(/\\/g, "/")}\u0000${startLine}`;
}
