import { useMemo } from 'react';

export type DiffLineKind =
  | 'add'
  | 'del'
  | 'hunk'
  | 'meta'
  | 'ctx'
  | 'empty';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo?: number;
  newNo?: number;
}

const HUNK_RE = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

export function parseUnifiedDiff(diff: string): DiffLine[] {
  if (!diff) return [{ kind: 'empty', text: '' }];

  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  return diff.split('\n').map((text) => {
    if (
      text.startsWith('+++') ||
      text.startsWith('---') ||
      text.startsWith('diff ') ||
      text.startsWith('index ') ||
      text.startsWith('new file') ||
      text.startsWith('deleted file') ||
      text.startsWith('similarity ') ||
      text.startsWith('rename ') ||
      text.startsWith('Binary ')
    ) {
      return { kind: 'meta' as const, text };
    }

    if (text.startsWith('@@')) {
      const match = HUNK_RE.exec(text);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
        inHunk = true;
      }
      return { kind: 'hunk' as const, text };
    }

    if (!inHunk) {
      return { kind: 'ctx' as const, text };
    }

    if (text.startsWith('+')) {
      const line: DiffLine = { kind: 'add', text, newNo };
      newNo += 1;
      return line;
    }
    if (text.startsWith('-')) {
      const line: DiffLine = { kind: 'del', text, oldNo };
      oldNo += 1;
      return line;
    }

    const line: DiffLine = { kind: 'ctx', text, oldNo, newNo };
    oldNo += 1;
    newNo += 1;
    return line;
  });
}

export function DiffView(props: { content: string }) {
  const lines = useMemo(() => parseUnifiedDiff(props.content), [props.content]);

  return (
    <pre className="workspace-diff" aria-label="Git diff">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`workspace-diff__line workspace-diff__line--${line.kind}`}
        >
          <span className="workspace-diff__gutter" aria-hidden>
            <span className="workspace-diff__no">
              {line.oldNo ?? ''}
            </span>
            <span className="workspace-diff__no">
              {line.newNo ?? ''}
            </span>
          </span>
          <span className="workspace-diff__text">
            {line.text.length === 0 ? ' ' : line.text}
          </span>
        </div>
      ))}
    </pre>
  );
}

/** Map porcelain-ish status letter to a CSS modifier. */
export function gitStatusKind(status: string): string {
  const s = status.trim().toUpperCase();
  if (!s) return 'unknown';
  const ch = s[0]!;
  if (ch === 'A' || ch === '?' || ch === 'U') return 'added';
  if (ch === 'D') return 'deleted';
  if (ch === 'M') return 'modified';
  if (ch === 'R') return 'renamed';
  if (ch === 'C') return 'copied';
  if (ch === '!' || ch === 'X') return 'conflict';
  return 'modified';
}
