import { fileURLToPath, pathToFileURL } from "node:url";
import { relative, resolve } from "node:path";
import { readFileSync } from "node:fs";

import type { CodeNavigationLocation } from "@mitii/v8";

type LspPosition = { line: number; character: number };
type LspRange = { start: LspPosition; end: LspPosition };

type LspLocation = {
  uri: string;
  range: LspRange;
};

type LspLocationLink = {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLocation(value: unknown): value is LspLocation {
  return (
    isRecord(value) &&
    typeof value.uri === "string" &&
    isRecord(value.range)
  );
}

function isLocationLink(value: unknown): value is LspLocationLink {
  return (
    isRecord(value) &&
    typeof value.targetUri === "string" &&
    isRecord(value.targetRange)
  );
}

function toFileUri(absolutePath: string): string {
  return pathToFileURL(absolutePath).href;
}

function fromFileUri(
  uri: string,
  workspaceRoot: string,
): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try {
    const absolute = resolve(fileURLToPath(uri));
    const relativePath = relative(workspaceRoot, absolute).replace(/\\/g, "/");
    if (
      !relativePath ||
      relativePath.startsWith("../") ||
      relativePath === ".."
    ) {
      return undefined;
    }
    return relativePath;
  } catch {
    return undefined;
  }
}

function mapRange(
  uri: string,
  range: LspRange,
  workspaceRoot: string,
  extras?: Partial<CodeNavigationLocation>,
): CodeNavigationLocation | undefined {
  const relativePath = fromFileUri(uri, workspaceRoot);
  if (!relativePath) return undefined;
  return {
    relativePath,
    startLine: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.character + 1,
    ...extras,
  };
}

export function mapLspLocations(
  result: unknown,
  workspaceRoot: string,
  maximum = 40,
): CodeNavigationLocation[] {
  if (result == null) return [];
  const entries = Array.isArray(result) ? result : [result];
  const locations: CodeNavigationLocation[] = [];
  for (const entry of entries) {
    if (locations.length >= maximum) break;
    if (isLocationLink(entry)) {
      const mapped = mapRange(
        entry.targetUri,
        entry.targetSelectionRange ?? entry.targetRange,
        workspaceRoot,
      );
      if (mapped) locations.push(mapped);
      continue;
    }
    if (isLocation(entry)) {
      const mapped = mapRange(entry.uri, entry.range, workspaceRoot);
      if (mapped) locations.push(mapped);
    }
  }
  return locations;
}

export function mapLspSymbolInformations(
  result: unknown,
  workspaceRoot: string,
  maximum = 40,
): CodeNavigationLocation[] {
  if (!Array.isArray(result)) return [];
  const locations: CodeNavigationLocation[] = [];
  for (const entry of result) {
    if (locations.length >= maximum) break;
    if (!isRecord(entry) || typeof entry.name !== "string") continue;
    const location = entry.location;
    if (!isLocation(location)) continue;
    const mapped = mapRange(location.uri, location.range, workspaceRoot, {
      symbolName: entry.name,
      ...(typeof entry.kind === "number"
        ? { symbolKind: String(entry.kind) }
        : {}),
    });
    if (mapped) locations.push(mapped);
  }
  return locations;
}

export function mapDocumentSymbols(
  result: unknown,
  relativePath: string,
  workspaceRoot: string,
  maximum = 40,
): CodeNavigationLocation[] {
  if (!Array.isArray(result)) return [];
  const locations: CodeNavigationLocation[] = [];
  const walk = (items: unknown[]) => {
    for (const item of items) {
      if (locations.length >= maximum) return;
      if (!isRecord(item) || typeof item.name !== "string") continue;
      if (isLocation(item.location)) {
        const mapped = mapRange(item.location.uri, item.location.range, workspaceRoot, {
          symbolName: item.name,
          ...(typeof item.kind === "number"
            ? { symbolKind: String(item.kind) }
            : {}),
        });
        if (mapped) locations.push(mapped);
      } else if (isRecord(item.selectionRange)) {
        const range = item.selectionRange as LspRange;
        locations.push({
          relativePath,
          startLine: range.start.line + 1,
          startColumn: range.start.character + 1,
          endLine: range.end.line + 1,
          endColumn: range.end.character + 1,
          symbolName: item.name,
          ...(typeof item.kind === "number"
            ? { symbolKind: String(item.kind) }
            : {}),
        });
      }
      if (Array.isArray(item.children)) {
        walk(item.children);
      }
    }
  };
  walk(result);
  return locations;
}

export function mapHover(result: unknown): { contents: string; language?: string } | undefined {
  if (!isRecord(result)) return undefined;
  const contents = result.contents;
  if (typeof contents === "string" && contents.trim()) {
    return { contents: contents.trim() };
  }
  if (isRecord(contents) && typeof contents.value === "string") {
    return {
      contents: contents.value.trim(),
      ...(typeof contents.language === "string"
        ? { language: contents.language }
        : {}),
    };
  }
  if (Array.isArray(contents)) {
    const parts = contents
      .map((part) => {
        if (typeof part === "string") return part.trim();
        if (isRecord(part) && typeof part.value === "string") return part.value.trim();
        return "";
      })
      .filter(Boolean);
    if (parts.length === 0) return undefined;
    return { contents: parts.join("\n\n") };
  }
  return undefined;
}

export function toTextDocumentIdentifier(absolutePath: string): {
  textDocument: { uri: string };
} {
  return { textDocument: { uri: toFileUri(absolutePath) } };
}

export function toTextDocumentPosition(
  absolutePath: string,
  line: number,
  column: number,
): {
  textDocument: { uri: string };
  position: LspPosition;
} {
  return {
    textDocument: { uri: toFileUri(absolutePath) },
    position: {
      line: Math.max(0, line - 1),
      character: Math.max(0, column - 1),
    },
  };
}

export function readDocumentText(absolutePath: string): string | undefined {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

export { toFileUri, fromFileUri };
