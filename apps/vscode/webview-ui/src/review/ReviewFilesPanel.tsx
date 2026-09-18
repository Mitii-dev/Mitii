import type { ReviewBarFile } from './reviewBarModel';
import { statusLabel, statusTone } from './reviewBarFormat';

type Props = {
  files: readonly ReviewBarFile[];
  onOpenDiff: (path: string) => void;
  onOpenFile: (path: string) => void;
};

/** Files tab — always this-chat Mitii edits, never the full git tree. */
export function ReviewFilesPanel({ files, onOpenDiff, onOpenFile }: Props) {
  if (files.length === 0) {
    return (
      <p className="wt-review__empty">
        No Mitii edits in this chat yet. Code Review still covers the full git
        working tree when enabled.
      </p>
    );
  }

  return (
    <ul className="wt-review__list">
      {files.map((file) => {
        const deleted = String(file.status).includes('D');
        return (
          <li key={file.path} className="wt-review__item">
            <button
              type="button"
              className="wt-review__file"
              onClick={() => onOpenDiff(file.path)}
              title={`Open diff for ${file.path}`}
            >
              <span
                className={`wt-review__status wt-review__status--${statusTone(String(file.status))}`}
              >
                {statusLabel(String(file.status))}
              </span>
              <span className="wt-review__path mono">{file.path}</span>
            </button>
            <button
              type="button"
              className="wt-review__link"
              disabled={deleted}
              onClick={() => onOpenFile(file.path)}
            >
              Open
            </button>
          </li>
        );
      })}
    </ul>
  );
}
