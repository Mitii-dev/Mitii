import { useRef, useState, type CSSProperties } from 'react';

import { ExplorerContextMenu } from '../explorer/ExplorerContextMenu.js';
import { ExplorerTreePane } from '../explorer/ExplorerTreePane.js';
import type { WorkspaceSide } from '../explorer/explorerTypes.js';
import { useEditorTabs, type EditorTabsModel } from '../explorer/hooks/useEditorTabs.js';
import { useExplorerFsOps } from '../explorer/hooks/useExplorerFsOps.js';
import { useExplorerTree } from '../explorer/hooks/useExplorerTree.js';
import { WorkspaceEditorPane } from '../explorer/WorkspaceEditorPane.js';
import { GitWorkingTreePane } from '../git/GitWorkingTreePane.js';
import { McpManager } from '../mcp/McpManager.js';
import { RecipesManager } from '../recipes/RecipesManager.js';
import { SkillsManager } from '../skills/SkillsManager.js';
import { IconFiles, IconGit } from './ActivityIcons.js';
import { useWorkspaceScm } from './hooks/useWorkspaceScm.js';
import { ResizeHandle, usePersistedWidth } from './ResizeHandle.js';

interface WorkspacePanelProps {
  baseUrl: string;
  token?: string;
  workspaceRoot: string;
  /** Compact header when embedded in Code mode. */
  embedded?: boolean;
  /** Hide the internal Files/Git rail (parent activity bar owns those icons). */
  hideActivityRail?: boolean;
  /** Controlled explorer/git/extensions pane (used with hideActivityRail). */
  side?: WorkspaceSide;
  onSideChange?: (side: WorkspaceSide) => void;
  /** Notify parent of open editor paths for context auto-pin. */
  onEditorContextChange?: (ctx: {
    activePath: string | null;
    openPaths: string[];
  }) => void;
  /** Fired after a successful workspace file save (for index debounce). */
  onFileSaved?: (path: string) => void;
  onGitCountChange?: (count: number) => void;
  /** Open this path when set (e.g. from chat file-changes card). */
  openPathRequest?: { path: string; view?: 'file' | 'diff' } | null;
  onOpenPathHandled?: () => void;
  /**
   * Bumped by the parent when the agent (or other host) mutates paths —
   * explorer + SCM refresh immediately without waiting for FS watch.
   */
  workspaceInvalidate?: { seq: number; paths: string[] } | null;
  /** Insert a recipe prompt into the chat composer. */
  onUsePrompt?: (prompt: string, mode?: 'ask' | 'plan' | 'agent') => void;
  onRestartEngine?: () => Promise<void>;
  /** Active provider profile (required to create/save skills). */
  activeProfileName?: string | null;
  hasActiveProfile?: boolean;
  onOpenProfiles?: () => void;
  /** Bubble Code Review findings to the chat composer strip. */
  onReviewFindingsChange?: (findings: import('../../shared/reviewFindings.js').ReviewFinding[]) => void;
  /** Disable branch switching while the agent is running. */
  agentBusy?: boolean;
  /** Show Code Review UI when settings.ui.features.codeReviewButton is on. */
  showCodeReview?: boolean;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const [internalSide, setInternalSide] = useState<WorkspaceSide>('explorer');
  const side = props.side ?? internalSide;
  const setSide = (next: WorkspaceSide) => {
    if (props.onSideChange) props.onSideChange(next);
    else setInternalSide(next);
  };

  const [error, setError] = useState<string | null>(null);
  const [, setNote] = useState<string | null>(null);
  const [sideWidth, setSideWidth] = usePersistedWidth('mitii.desktop.explorerWidth', {
    initial: 260,
    min: 160,
    max: 520,
  });

  const scm = useWorkspaceScm({
    baseUrl: props.baseUrl,
    token: props.token,
    workspaceRoot: props.workspaceRoot,
    side,
    onGitCountChange: props.onGitCountChange,
    onError: setError,
  });

  // The tree reports changed paths to the editor, which is created after it.
  const editorRef = useRef<EditorTabsModel | null>(null);
  const tree = useExplorerTree({
    baseUrl: props.baseUrl,
    token: props.token,
    workspaceRoot: props.workspaceRoot,
    workspaceInvalidate: props.workspaceInvalidate,
    onError: setError,
    onPathsChanged: (paths) => void editorRef.current?.reloadCleanOpenFiles(paths),
    onGitStale: scm.onWatchSettled,
  });

  const editor = useEditorTabs({
    baseUrl: props.baseUrl,
    token: props.token,
    workspaceRoot: props.workspaceRoot,
    onError: setError,
    onNote: setNote,
    onSideChange: setSide,
    revealPaths: tree.revealPaths,
    onSaved: () => void scm.loadGit(),
    onFileSaved: props.onFileSaved,
    onEditorContextChange: props.onEditorContextChange,
    openPathRequest: props.openPathRequest,
    onOpenPathHandled: props.onOpenPathHandled,
  });
  editorRef.current = editor;

  const fsOps = useExplorerFsOps({
    baseUrl: props.baseUrl,
    token: props.token,
    tree,
    editor,
    onError: setError,
    onNote: setNote,
    onGitChanged: () => void scm.loadGit(),
  });

  const extensionsFullscreen =
    side === 'mcp' || side === 'skills' || side === 'recipes';
  const sideColumnWidth = extensionsFullscreen
    ? props.hideActivityRail
      ? 0
      : 44
    : sideWidth;
  const activeFilePath =
    editor.active?.mode === 'file' ? editor.active.path : null;
  const closeMenu = () => fsOps.setContextMenu(null);

  return (
    <div className={`workspace-view${props.embedded ? ' workspace-view--embedded' : ''}`}>
      <div
        className="workspace-body"
        style={
          {
            gridTemplateColumns: extensionsFullscreen
              ? `${sideColumnWidth}px 0 minmax(0, 1fr)`
              : `${sideWidth}px 5px minmax(0, 1fr)`,
          } as CSSProperties
        }
      >
        <aside
          className={`workspace-side${props.hideActivityRail ? ' workspace-side--flush' : ''}${
            extensionsFullscreen ? ' workspace-side--rail-only' : ''
          }`}
        >
          {props.hideActivityRail ? null : (
            <div className="activity-rail" aria-label="Workspace views">
              <button
                type="button"
                className={side === 'explorer' ? 'is-active' : undefined}
                title="Explorer"
                aria-label="Explorer"
                onClick={() => setSide('explorer')}
              >
                <IconFiles size={20} />
              </button>
              <button
                type="button"
                className={side === 'git' ? 'is-active' : undefined}
                title="Source Control"
                aria-label="Source Control"
                onClick={() => {
                  setSide('git');
                  void scm.loadGit();
                }}
              >
                <IconGit size={20} />
                {scm.git?.changeCount || scm.git?.files.length ? (
                  <em className="activity-badge">
                    {scm.git.changeCount ?? scm.git.files.length}
                  </em>
                ) : null}
              </button>
            </div>
          )}

          {extensionsFullscreen ? null : (
            <div className="workspace-pane">
              {side === 'explorer' ? (
                <ExplorerTreePane
                  baseUrl={props.baseUrl}
                  token={props.token}
                  workspaceRoot={props.workspaceRoot}
                  tree={tree}
                  fsOps={fsOps}
                  activeFilePath={activeFilePath}
                  agentBusy={props.agentBusy}
                  onRefresh={() => {
                    void tree.reloadAll().then(() => scm.refresh());
                  }}
                  onBranchChanged={scm.refresh}
                />
              ) : side === 'git' ? (
                <GitWorkingTreePane
                  baseUrl={props.baseUrl}
                  token={props.token}
                  activePath={editor.activePath}
                  refreshToken={scm.refreshToken}
                  showCodeReview={props.showCodeReview}
                  onOpenDiff={editor.openDiff}
                  onOpenFile={(path) => editor.openFile(path, { pin: true })}
                  onGitCountChange={(count) => {
                    props.onGitCountChange?.(count);
                  }}
                  onStatusSnapshot={(next) => {
                    scm.setGit(next);
                    props.onGitCountChange?.(next.changeCount ?? next.files.length);
                  }}
                  onUsePrompt={props.onUsePrompt}
                  onStatusNote={setNote}
                  onError={setError}
                  onPathsDiscarded={(paths) => {
                    setError(null);
                    void editor.handlePathsDiscarded([...paths]);
                  }}
                  onFindingsChange={props.onReviewFindingsChange}
                />
              ) : null}
            </div>
          )}
        </aside>

        {extensionsFullscreen ? (
          <div aria-hidden className="workspace-resize-spacer" />
        ) : (
          <ResizeHandle
            value={sideWidth}
            onChange={setSideWidth}
            min={160}
            max={520}
            label="Resize explorer"
          />
        )}

        <section
          className={`editor-shell${
            extensionsFullscreen ? ' editor-shell--extensions' : ''
          }`}
        >
          {side === 'mcp' ? (
            <McpManager
              baseUrl={props.baseUrl}
              token={props.token}
              onRestartEngine={props.onRestartEngine}
            />
          ) : side === 'skills' ? (
            <SkillsManager
              baseUrl={props.baseUrl}
              token={props.token}
              activeProfileName={props.activeProfileName}
              hasActiveProfile={Boolean(props.hasActiveProfile)}
              onOpenProfiles={props.onOpenProfiles}
            />
          ) : side === 'recipes' ? (
            <RecipesManager
              baseUrl={props.baseUrl}
              token={props.token}
              onUsePrompt={props.onUsePrompt}
            />
          ) : (
            <WorkspaceEditorPane
              editor={editor}
              error={error}
              statPreview={scm.git?.statPreview}
            />
          )}
        </section>
      </div>

      {fsOps.contextMenu ? (
        <ExplorerContextMenu
          menu={fsOps.contextMenu}
          entryByPath={tree.entryByPath}
          clipboard={fsOps.clipboard}
          onClose={closeMenu}
          onBeginCreate={(kind, paths) => void fsOps.beginCreate(kind, paths)}
          onOpenFile={(path) => void editor.openFile(path, { pin: true })}
          onClipboard={fsOps.setClipboardFromSelection}
          onPaste={(paths) => void fsOps.pasteClipboard(paths)}
          onCopyAbsolutePaths={(paths) => void fsOps.copyAbsolutePaths(paths)}
          onCopyRelativePaths={(paths) => void fsOps.copyRelativePaths(paths)}
          onCopyNames={(paths) => void fsOps.copyNames(paths)}
          onReveal={(paths) => void fsOps.revealInOs(paths)}
          onRename={fsOps.beginRename}
          onDelete={(paths) => void fsOps.deleteSelected(paths)}
        />
      ) : null}
    </div>
  );
}
