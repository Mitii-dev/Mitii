import type { ReviewFindingChip } from './reviewFindingTypes';
import { severityTone } from './reviewBarFormat';

type Props = {
  findings: readonly ReviewFindingChip[];
  running?: boolean;
  onOpenFinding?: (path: string, line?: number) => void;
  onOpenFile: (path: string) => void;
  onFixFinding?: (index: number) => void;
};

/** Findings tab — severity chips + per-row Fix (Code Review feature only). */
export function ReviewFindingsPanel({
  findings,
  running = false,
  onOpenFinding,
  onOpenFile,
  onFixFinding,
}: Props) {
  if (findings.length === 0) {
    return (
      <p className="wt-review__empty">
        No findings yet. Click Code Review to analyze the git working-tree
        changes.
      </p>
    );
  }

  return (
    <ul className="wt-review__list">
      {findings.map((f, i) => {
        const fixed = f.status === 'fixed';
        return (
          <li
            key={`${f.path}:${f.startLine ?? 0}:${i}`}
            className={`wt-review__item${fixed ? ' wt-review__item--fixed' : ''}`}
          >
            <button
              type="button"
              className="wt-review__file"
              onClick={() => {
                if (onOpenFinding) onOpenFinding(f.path, f.startLine);
                else onOpenFile(f.path);
              }}
              title={`Open ${f.path}${f.startLine ? `:${f.startLine}` : ''}`}
            >
              <span
                className={`wt-review__sev wt-review__sev--${severityTone(f.severity)}`}
              >
                {fixed ? 'fixed' : f.severity}
              </span>
              <span className="wt-review__path mono">
                {f.path}
                {f.startLine ? `:${f.startLine}` : ''}
              </span>
              <span className="wt-review__finding-text">{f.content}</span>
            </button>
            {!fixed && onFixFinding ? (
              <button
                type="button"
                className="wt-review__link"
                disabled={running}
                title="Fix this finding in Agent mode"
                onClick={() => onFixFinding(i)}
              >
                Fix
              </button>
            ) : fixed ? (
              <span className="wt-review__fixed-mark" aria-hidden>
                ✓
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
