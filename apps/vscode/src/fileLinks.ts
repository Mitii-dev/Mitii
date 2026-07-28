/**
 * Detect workspace-relative file path references in assistant markdown.
 * Pure helpers — shared by webview rendering decisions and host openFile.
 */

const PATH_LIKE =
  /^(?:\.\/|[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?$/;
const BARE_FILE =
  /^[\w@.-]+\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?$/;

export interface ParsedFileRef {
  path: string;
  line?: number;
  column?: number;
}

/**
 * True when `href` or bare text looks like a workspace file reference
 * (not http/mailto/anchors).
 */
export function looksLikeWorkspaceFileRef(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(https?:|mailto:|#|vscode:)/i.test(trimmed)) return false;
  if (trimmed.startsWith('file://')) return true;
  const withoutScheme = trimmed.replace(/^file:\/\//i, '');
  return PATH_LIKE.test(withoutScheme) || BARE_FILE.test(withoutScheme);
}

/**
 * Parse `path`, `path:line`, `path:line:col`, or `file:///...` into a ref.
 */
export function parseFileRef(value: string): ParsedFileRef | null {
  const trimmed = value.trim();
  if (!trimmed || !looksLikeWorkspaceFileRef(trimmed)) return null;

  let raw = trimmed;
  if (raw.toLowerCase().startsWith('file://')) {
    try {
      raw = decodeURIComponent(new URL(raw).pathname);
      // Windows file URLs may start with /C:/...
      if (/^\/[A-Za-z]:\//.test(raw)) {
        raw = raw.slice(1);
      }
    } catch {
      raw = trimmed.replace(/^file:\/\//i, '');
    }
  }

  const match = /^(.*?)(?::(\d+))(?::(\d+))?$/.exec(raw);
  if (match && match[2] && /\.\w{1,12}$/.test(match[1] ?? '')) {
    return {
      path: (match[1] ?? raw).replace(/\\/g, '/'),
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : undefined,
    };
  }

  return { path: raw.replace(/\\/g, '/') };
}

/**
 * Inline code that is only a file path should become a file link.
 */
export function inlineCodeAsFileRef(text: string): ParsedFileRef | null {
  return parseFileRef(text.trim());
}
