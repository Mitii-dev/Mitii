/**
 * Agent Working Tree pane — VS Code–style SCM layout (commit, recipes).
 * Branch switching lives in the Explorer footer.
 */

import { useMemo, useState, type KeyboardEvent } from 'react';

import { ResizeHandle, usePersistedHeight } from '../shell/ResizeHandle.js';
import { useGitWorkingTreeStatus } from './hooks/useGitWorkingTreeStatus.js';
import { useScmJobs } from './hooks/useScmJobs.js';
import { useScmMutations } from './hooks/useScmMutations.js';
import { useScmSelection } from './hooks/useScmSelection.js';
import { ScmCommitBox } from './ScmCommitBox.js';
import { ScmContextMenu } from './ScmContextMenu.js';
import { ScmPaneHeader } from './ScmPaneHeader.js';
import { ScmResourceGroup } from './ScmResourceGroup.js';
import { ScmReviewPanel } from './ScmReviewPanel.js';
import type { GitWorkingTreePaneProps } from './scmTypes.js';

export type { GitWorkingTreePaneProps } from './scmTypes.js';

export function GitWorkingTreePane(props: GitWorkingTreePaneProps) {
  const auth = useMemo(
    () => ({ baseUrl: props.baseUrl, token: props.token }),
    [props.baseUrl, props.token],
  );
  const showCodeReview = props.showCodeReview === true;
  const [commitMessage, setCommitMessage] = useState('');
  const [openGroups, setOpenGroups] = useState({ staged: true, changes: true });
  const [changesHeight, setChangesHeight] = usePersistedHeight(
    'mitii.desktop.gitChangesHeight',
    { initial: 420, min: 200, max: 900 },
  );

  const selection = useScmSelection();
  const { git, changeFiles, untrackedPathSet, fileByPath, applyStatus, loadGit } =
    useGitWorkingTreeStatus({
      baseUrl: props.baseUrl,
      token: props.token,
      refreshToken: props.refreshToken,
      onGitCountChange: props.onGitCountChange,
      onStatusSnapshot: props.onStatusSnapshot,
      onError: props.onError,
      onValidPaths: selection.pruneSelection,
    });
  const mutations = useScmMutations({
    auth,
    applyStatus,
    loadGit,
    onError: props.onError,
    onStatusNote: props.onStatusNote,
    onPathsDiscarded: props.onPathsDiscarded,
  });
  const jobs = useScmJobs({
    auth,
    showCodeReview,
    reviewPaths: (git?.files ?? []).map((f) => f.path),
    loadGit,
    setCommitMessage,
    onOpenFile: props.onOpenFile,
    onStatusNote: props.onStatusNote,
    onError: props.onError,
    onFindingsChange: props.onFindingsChange,
  });

  const { busy } = mutations;
  const { activeJob } = jobs;
  const jobRunning = Boolean(activeJob);
  const controlsDisabled = busy || jobRunning;
  const canCommit =
    Boolean(commitMessage.trim()) &&
    Boolean(git?.staged.length) &&
    !busy &&
    !jobRunning;

  const doCommit = () => {
    const message = commitMessage.trim();
    void mutations.commit(message).then(() => {
      setCommitMessage('');
    });
  };

  const toggleGroup = (key: keyof typeof openGroups) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const onBodyKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    const { selectedPaths } = selection;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'c' && selectedPaths.size > 0) {
      e.preventDefault();
      void navigator.clipboard.writeText([...selectedPaths].join('\n'));
      props.onStatusNote?.('Copied paths');
      window.setTimeout(() => props.onStatusNote?.(null), 1200);
      return;
    }
    if (e.key === 'Escape' && selectedPaths.size > 0) {
      e.preventDefault();
      selection.clearSelection();
    }
  };

  const groupShared = {
    disabled: controlsDisabled,
    activePath: props.activePath,
    selectedPaths: selection.selectedPaths,
    pathsForAction: selection.pathsForAction,
    onSelect: selection.selectInGroup,
    onContextMenu: selection.openContextMenu,
    onOpenDiff: props.onOpenDiff,
    onOpenFile: props.onOpenFile,
  };

  return (
    <div className={`scm-pane${showCodeReview ? '' : ' scm-pane--no-review'}`}>
      <div
        className="scm-pane__main"
        style={
          showCodeReview ? { flex: `0 0 ${changesHeight}px` } : { flex: '1 1 auto' }
        }
      >
        <ScmPaneHeader
          git={git}
          activeJob={activeJob}
          busy={busy}
          showCodeReview={showCodeReview}
          findingsCount={jobs.reviewFindings.length}
          onStop={jobs.stopJob}
          onCodeReview={() => void jobs.runCodeReview()}
          onRefresh={() => void loadGit()}
        />

        <ScmCommitBox
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          busy={busy}
          activeJob={activeJob}
          hasFiles={Boolean(git?.files.length)}
          canCommit={canCommit}
          onCommit={doCommit}
          onGenerate={() => void jobs.generateCommitMessage()}
          onChangelog={() => void jobs.runChangelogUpdate()}
          onPrSummary={() => void jobs.runPrSummary()}
          onReleaseNotes={() => void jobs.runReleaseNotes()}
        />

        <div className="scm-body" tabIndex={0} onKeyDown={onBodyKeyDown}>
          <ScmResourceGroup
            {...groupShared}
            groupKey="staged"
            title="Staged Changes"
            files={git?.staged ?? []}
            open={openGroups.staged}
            onToggle={() => toggleGroup('staged')}
            actions={{
              primaryTitle: 'Unstage',
              primarySymbol: '−',
              onPrimary: (paths) => void mutations.unstagePaths(paths),
              onPrimaryAll: () => void mutations.unstagePaths(),
            }}
          />
          <ScmResourceGroup
            {...groupShared}
            groupKey="changes"
            title="Changes"
            files={changeFiles}
            open={openGroups.changes}
            onToggle={() => toggleGroup('changes')}
            actions={{
              primaryTitle: 'Stage',
              primarySymbol: '+',
              onPrimary: (paths) => void mutations.stagePaths(paths),
              onPrimaryAll: () =>
                void mutations.stagePaths(changeFiles.map((f) => f.path)),
              dangerTitle: 'Discard',
              onDanger: (paths) =>
                mutations.discardPaths(paths, untrackedPathSet),
            }}
          />

          {git && git.ok && git.files.length === 0 ? (
            <p className="scm-empty scm-empty--center">
              There are no changes to commit.
            </p>
          ) : null}
          {git && !git.ok ? (
            <p className="scm-empty scm-empty--center">{git.summary}</p>
          ) : null}
        </div>
      </div>

      {showCodeReview ? (
        <>
          <ResizeHandle
            orientation="horizontal"
            value={changesHeight}
            onChange={setChangesHeight}
            min={200}
            max={900}
            label="Resize source control and review"
          />
          <ScmReviewPanel
            findings={jobs.reviewFindings}
            error={jobs.reviewError}
            running={activeJob === 'code-review'}
            onOpenDiff={props.onOpenDiff}
          />
        </>
      ) : null}

      {selection.contextMenu ? (
        <ScmContextMenu
          menu={selection.contextMenu}
          fileByPath={fileByPath}
          untrackedPathSet={untrackedPathSet}
          disabled={controlsDisabled}
          onClose={() => selection.setContextMenu(null)}
          onStage={(paths) => void mutations.stagePaths(paths)}
          onUnstage={(paths) => void mutations.unstagePaths(paths)}
          onStash={(paths, includeUntracked) =>
            void mutations.stashPaths(paths, includeUntracked)
          }
        />
      ) : null}
    </div>
  );
}
