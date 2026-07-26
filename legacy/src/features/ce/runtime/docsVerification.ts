import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'path';

export interface DocumentationVerificationResult {
  checkedFiles: string[];
  issues: Array<{ file: string; line: number; message: string }>;
}

/** Lightweight, deterministic Markdown verification for documentation-only edits. */
export function verifyDocumentationFiles(
  workspace: string,
  touchedFiles: string[]
): DocumentationVerificationResult {
  const checkedFiles = touchedFiles.filter((file) => /\.mdx?$/i.test(file));
  const issues: DocumentationVerificationResult['issues'] = [];

  for (const relPath of checkedFiles) {
    const absolutePath = resolve(workspace, relPath);
    if (!isWorkspaceFile(workspace, absolutePath)) {
      issues.push({ file: relPath, line: 1, message: 'Referenced Markdown file is outside the workspace or missing.' });
      continue;
    }

    const content = readFileSync(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const anchors = collectAnchors(lines);
    const fenceCount = lines.filter((line) => /^\s*```/.test(line)).length;
    if (fenceCount % 2 !== 0) {
      issues.push({ file: relPath, line: lines.length, message: 'Unclosed fenced code block.' });
    }

    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
        const rawTarget = match[1].trim().replace(/^<|>$/g, '');
        if (!rawTarget || /^(?:https?:|mailto:|data:)/i.test(rawTarget)) continue;
        const [pathPart, fragment] = rawTarget.split('#', 2);

        if (!pathPart) {
          if (fragment && !anchors.has(normalizeAnchor(fragment))) {
            issues.push({ file: relPath, line: index + 1, message: `Missing local anchor: #${fragment}` });
          }
          continue;
        }

        const decodedPath = safeDecode(pathPart);
        const targetPath = normalize(join(dirname(absolutePath), decodedPath));
        if (!isWorkspaceFile(workspace, targetPath)) {
          issues.push({ file: relPath, line: index + 1, message: `Missing referenced path: ${pathPart}` });
          continue;
        }

        if (fragment && /\.mdx?$/i.test(extname(targetPath))) {
          const targetAnchors = collectAnchors(readFileSync(targetPath, 'utf8').split(/\r?\n/));
          if (!targetAnchors.has(normalizeAnchor(fragment))) {
            issues.push({ file: relPath, line: index + 1, message: `Missing anchor #${fragment} in ${pathPart}` });
          }
        }
      }
    }
  }

  return { checkedFiles, issues };
}

export function formatDocumentationVerification(result: DocumentationVerificationResult): string {
  if (result.checkedFiles.length === 0) return '';
  if (result.issues.length === 0) {
    return `Markdown validation passed for ${result.checkedFiles.length} file(s): links, anchors, referenced paths, and code fences.`;
  }
  return [
    `Markdown validation found ${result.issues.length} issue(s):`,
    ...result.issues.map((issue) => `- ${issue.file}:${issue.line} ${issue.message}`),
  ].join('\n');
}

function collectAnchors(lines: string[]): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of lines) {
    const match = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const base = normalizeAnchor(match[1]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function normalizeAnchor(value: string): string {
  return safeDecode(value)
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isWorkspaceFile(workspace: string, path: string): boolean {
  const root = resolve(workspace);
  const target = resolve(path);
  const rel = relative(root, target);
  return !rel.startsWith('..') && !isAbsolute(rel) && existsSync(target) && statSync(target).isFile();
}
