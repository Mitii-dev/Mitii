import logoUrl from '../assets/mitii-logo.svg';
import { MarkdownBody } from '../chat/MarkdownBody.js';
import { IconOpenPreview } from '../shell/ActivityIcons.js';
import { CodeEditor } from './CodeEditor.js';
import { DiffView } from './DiffView.js';
import type { EditorTabsModel } from './hooks/useEditorTabs.js';
import { fileName } from './pathUtils.js';

export interface WorkspaceEditorPaneProps {
  editor: EditorTabsModel;
  error: string | null;
  /** `git diff --stat` preview shown on the empty hero. */
  statPreview?: string | null;
}

export function WorkspaceEditorPane({
  editor,
  error,
  statPreview,
}: WorkspaceEditorPaneProps) {
  const { tabs, activePath, active, mdPreview } = editor;
  return (
    <>
      {tabs.length > 0 ? (
        <div className="editor-tabs-row">
          <div className="editor-tabs" role="tablist">
            {tabs.map((tab) => (
              <div
                key={tab.path}
                className={`editor-tab${
                  tab.path === activePath ? ' is-active' : ''
                }${tab.content !== tab.savedContent ? ' is-dirty' : ''}${
                  tab.preview ? ' is-preview' : ''
                }`}
                role="tab"
                aria-selected={tab.path === activePath}
              >
                <button
                  type="button"
                  className="editor-tab__label"
                  onClick={() => editor.setActivePath(tab.path)}
                  onDoubleClick={() => {
                    if (tab.mode === 'file') editor.pinTab(tab.path);
                  }}
                  title={tab.path}
                >
                  {tab.mode === 'diff'
                    ? `${fileName(tab.path.replace(/^diff:/, ''))} (diff)`
                    : fileName(tab.path)}
                </button>
                <button
                  type="button"
                  className="editor-tab__close"
                  aria-label={`Close ${tab.path}`}
                  onClick={() => editor.closeTab(tab.path)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {editor.activeIsMarkdown ? (
            <button
              type="button"
              className={`editor-tabs__action${mdPreview ? ' is-active' : ''}`}
              title={mdPreview ? 'Show source' : 'Open preview'}
              aria-label={mdPreview ? 'Show source' : 'Open preview'}
              aria-pressed={mdPreview}
              onClick={() => editor.setMdPreview((v) => !v)}
            >
              <IconOpenPreview size={16} />
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="alert">{error}</div> : null}

      {active ? (
        <>
          {active.truncated ? (
            <div className="editor-banner">Truncated on open — read-only</div>
          ) : null}
          {active.mode === 'diff' ? (
            <DiffView content={active.content} />
          ) : active.loading ? (
            <div className="workspace-hero workspace-hero--opening">
              <p>Opening {fileName(active.path)}…</p>
              <p className="field-help">
                If indexing is running, this may take a moment.
              </p>
            </div>
          ) : editor.showMdPreview ? (
            <div className="md-file-preview">
              <MarkdownBody text={active.content} />
            </div>
          ) : (
            <CodeEditor
              path={active.path}
              value={active.content}
              readOnly={active.truncated}
              onChange={editor.updateActiveContent}
              onKeyDown={editor.onEditorKeyDown}
            />
          )}
        </>
      ) : (
        <div className="workspace-hero">
          <h2>EXPLORER</h2>
          <p>
            Single-click to preview a file. Double-click to keep it open. Edits
            autosave — <kbd>⌘Z</kbd> / <kbd>Ctrl+Z</kbd> to undo.
          </p>
          <div className="workspace-hero__brand">
            <img
              className="workspace-hero__logo"
              src={logoUrl}
              alt="Mitii"
              width={120}
              height={120}
              decoding="async"
            />
            <span className="workspace-hero__wordmark">Mitii</span>
          </div>
          {statPreview ? (
            <pre className="workspace-stat">{statPreview}</pre>
          ) : null}
        </div>
      )}
    </>
  );
}
