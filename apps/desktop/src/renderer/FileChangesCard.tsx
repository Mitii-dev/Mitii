import { useState } from 'react';

import type { DesktopFileChanges } from '../shared/fileChanges.js';
import { DiffView } from './DiffView.js';

interface FileChangesCardProps {
  changes: DesktopFileChanges;
  onOpenFile?: (path: string) => void;
}

function statusLabel(status: DesktopFileChanges['files'][number]['status']): string {
  switch (status) {
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'M':
      return 'Edited';
    default:
      return 'Changed';
  }
}

export function FileChangesCard(props: FileChangesCardProps) {
  const { changes } = props;
  const [expanded, setExpanded] = useState(true);
  const [openDiff, setOpenDiff] = useState<string | null>(null);
  const n = changes.files.length;
  if (n === 0) return null;

  return (
    <section className="file-changes-card" aria-label="Files changed">
      <header className="file-changes-card__header">
        <button
          type="button"
          className="file-changes-card__summary"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="file-changes-card__chevron" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
          <strong>
            {n} file{n === 1 ? '' : 's'} changed
          </strong>
          <span className="diff-add">+{changes.totalAdditions}</span>
          <span className="diff-del">−{changes.totalDeletions}</span>
        </button>
      </header>
      {expanded ? (
        <ul className="file-changes-card__list">
          {changes.files.map((file) => {
            const showDiff = openDiff === file.path;
            return (
              <li key={file.path} className="file-changes-card__item">
                <div className="file-changes-card__row">
                  <span
                    className={`file-changes-card__status file-changes-card__status--${file.status}`}
                  >
                    {statusLabel(file.status)}
                  </span>
                  <button
                    type="button"
                    className="file-changes-card__path"
                    title={file.path}
                    onClick={() => props.onOpenFile?.(file.path)}
                  >
                    {file.path}
                  </button>
                  <button
                    type="button"
                    className="file-changes-card__stats"
                    onClick={() =>
                      setOpenDiff(showDiff ? null : file.path)
                    }
                    title={showDiff ? 'Hide diff' : 'Show diff'}
                  >
                    <span className="diff-add">+{file.additions}</span>
                    <span className="diff-del">−{file.deletions}</span>
                  </button>
                </div>
                {showDiff && file.patchPreview ? (
                  <div className="file-changes-card__diff">
                    <DiffView content={file.patchPreview} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
