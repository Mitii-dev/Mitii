import type {
  ReviewChangedFile,
  ReviewFinding,
  ReviewWarning,
} from "../contracts";
import { normalizeRelativePath } from "../internal/pathUtils";

/**
 * Anchor findings to line numbers using existingCode against file content/diff.
 * Soft-fail: unanchored findings keep anchored=false.
 */
export function anchorFindings(params: {
  findings: readonly ReviewFinding[];
  files: readonly ReviewChangedFile[];
}): { findings: ReviewFinding[]; warnings: ReviewWarning[] } {
  const warnings: ReviewWarning[] = [];
  const byPath = new Map(
    params.files.map((f) => [normalizeRelativePath(f.path), f]),
  );

  const findings = params.findings.map((raw) => {
    const path = normalizeRelativePath(raw.path);
    const file = byPath.get(path);
    const snippet = raw.existingCode.trim();
    if (!snippet) {
      warnings.push({
        code: "anchor_failed",
        message: `Finding on ${path} has empty existingCode.`,
      });
      return { ...raw, path, anchored: false };
    }

    // Prefer full file content; fall back to reconstructing from diff + other files
    let content = file?.content;
    if (!content && file?.diff) {
      content = contentFromUnifiedDiff(file.diff);
    }
    if (!content) {
      // Cross-file search
      for (const candidate of params.files) {
        const text = candidate.content ?? contentFromUnifiedDiff(candidate.diff);
        if (text && text.includes(snippet)) {
          const range = locateSnippet(text, snippet);
          return {
            ...raw,
            path: normalizeRelativePath(candidate.path),
            startLine: range?.startLine,
            endLine: range?.endLine,
            anchored: Boolean(range),
          };
        }
      }
      warnings.push({
        code: "anchor_failed",
        message: `Could not anchor finding on ${path}.`,
      });
      return { ...raw, path, anchored: false };
    }

    const range = locateSnippet(content, snippet);
    if (!range) {
      warnings.push({
        code: "anchor_failed",
        message: `existingCode not found in ${path}.`,
      });
      return { ...raw, path, anchored: false };
    }
    return {
      ...raw,
      path,
      startLine: range.startLine,
      endLine: range.endLine,
      anchored: true,
    };
  });

  return { findings, warnings };
}

function locateSnippet(
  content: string,
  snippet: string,
): { startLine: number; endLine: number } | undefined {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const normalizedSnippet = snippet.replace(/\r\n/g, "\n").trimEnd();
  const index = normalizedContent.indexOf(normalizedSnippet);
  if (index < 0) {
    // Try line-trimmed match
    return locateByLines(normalizedContent, normalizedSnippet);
  }
  const before = normalizedContent.slice(0, index);
  const startLine = before.split("\n").length;
  const snippetLines = normalizedSnippet.split("\n").length;
  return { startLine, endLine: startLine + snippetLines - 1 };
}

function locateByLines(
  content: string,
  snippet: string,
): { startLine: number; endLine: number } | undefined {
  const contentLines = content.split("\n");
  const snippetLines = snippet.split("\n").map((l) => l.trim());
  if (snippetLines.length === 0) return undefined;
  for (let i = 0; i <= contentLines.length - snippetLines.length; i += 1) {
    let ok = true;
    for (let j = 0; j < snippetLines.length; j += 1) {
      if (contentLines[i + j]!.trim() !== snippetLines[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return { startLine: i + 1, endLine: i + snippetLines.length };
    }
  }
  return undefined;
}

/** Best-effort: join added lines from a unified diff as a pseudo-file. */
export function contentFromUnifiedDiff(diff: string): string {
  const lines: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) {
      lines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      continue;
    } else if (line.startsWith(" ")) {
      lines.push(line.slice(1));
    }
  }
  return lines.join("\n");
}
