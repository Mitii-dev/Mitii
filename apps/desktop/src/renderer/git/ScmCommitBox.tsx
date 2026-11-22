import { useEffect, useRef, useState } from 'react';

import type { ScmJob } from './scmTypes.js';

interface ScmCommitBoxProps {
  commitMessage: string;
  onCommitMessageChange: (message: string) => void;
  busy: boolean;
  activeJob: ScmJob | null;
  hasFiles: boolean;
  canCommit: boolean;
  onCommit: () => void;
  onGenerate: () => void;
  onChangelog: () => void;
  onPrSummary: () => void;
  onReleaseNotes: () => void;
}

export function ScmCommitBox(props: ScmCommitBoxProps) {
  const { busy, activeJob, canCommit } = props;
  const jobRunning = Boolean(activeJob);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  return (
    <div className="scm-input">
      <textarea
        value={props.commitMessage}
        onChange={(e) => props.onCommitMessageChange(e.target.value)}
        placeholder="Message (Ctrl+Enter to commit)"
        rows={4}
        disabled={busy || jobRunning}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) {
            e.preventDefault();
            props.onCommit();
          }
        }}
      />
      <div className="scm-input__toolbar">
        <div className="scm-input__toolbar-right">
          <button
            type="button"
            className="scm-text-btn"
            disabled={busy || jobRunning || !props.hasFiles}
            title="Generate commit message"
            onClick={props.onGenerate}
          >
            {activeJob === 'commit-message' ? '…' : 'Generate'}
          </button>
          <button
            type="button"
            className="scm-commit-btn"
            disabled={!canCommit}
            onClick={props.onCommit}
          >
            Commit
          </button>
        </div>
      </div>
      <div className="scm-input__recipes">
        <button
          type="button"
          className="scm-text-btn"
          disabled={busy || jobRunning}
          title="Generate and update CHANGELOG.md"
          onClick={props.onChangelog}
        >
          {activeJob === 'changelog' ? 'Changelog…' : 'Changelog'}
        </button>
        <div className="scm-more" ref={moreRef}>
          <button
            type="button"
            className="scm-text-btn"
            disabled={busy || jobRunning}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            title="More writing actions"
            onClick={() => setMoreOpen((v) => !v)}
          >
            More
          </button>
          {moreOpen ? (
            <div className="scm-more__menu explorer-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  props.onPrSummary();
                }}
              >
                PR summary
                <span className="scm-more__hint">Copy to clipboard</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  props.onReleaseNotes();
                }}
              >
                Release notes
                <span className="scm-more__hint">Write RELEASE-NOTES.md</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
