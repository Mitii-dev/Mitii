/**
 * Agent Working Tree pane — VS Code–style SCM layout (branch, commit, recipes).
 * Thin Mitii surface: not a full SCM clone.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
} from '../shared/gitWorkingTree.js';
import {
  CODE_REVIEW_PROMPT,
  ingestReviewFinding,
  type ReviewFinding,
} from '../shared/reviewFindings.js';
import {
  IconChevronDown,
  IconChevronRight,
  IconGit,
  IconPlus,
  IconRefresh,
} from './ActivityIcons.js';
import {
  extractAssistantText,
  fetchGitBranches,
  fetchGitStatus,
  finalizeAssistantText,
  gitCheckoutBranch,
  gitCommitChanges,
  gitDiscardFiles,
  gitStageFiles,
  gitUnstageFiles,
  runRecipe,
  streamPrompt,
} from './api.js';
import { gitStatusKind } from './DiffView.js';
import { ResizeHandle, usePersistedHeight } from './ResizeHandle.js';

function unwrapRecipeAnswer(answer: string): string {
  const trimmed = answer.trim();
  const fenced = trimmed.match(/^```(?:\w+)?\r?\n([\s\S]*?)\r?\n```$/);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

function fileLeaf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

function fileDir(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i <= 0 ? '' : norm.slice(0, i);
}

interface GitWorkingTreePaneProps {
  baseUrl: string;
  token?: string;
  activePath: string | null;
  onOpenDiff: (path: string) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
  onGitCountChange?: (count: number) => void;
  onStatusSnapshot?: (status: GitWorkingTreeSnapshot) => void;
  onUsePrompt?: (prompt: string, mode?: 'ask' | 'plan' | 'agent') => void;
  onStatusNote?: (note: string | null) => void;
  onError?: (error: string | null) => void;
  /** Bubble Code Review findings to the chat composer strip. */
  onFindingsChange?: (findings: ReviewFinding[]) => void;
}

export function GitWorkingTreePane(props: GitWorkingTreePaneProps) {
  const auth = { baseUrl: props.baseUrl, token: props.token };
  const [git, setGit] = useState<GitWorkingTreeSnapshot | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[]>([]);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchOpen, setBranchOpen] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [commitAll, setCommitAll] = useState(false);
  const [openGroups, setOpenGroups] = useState({
    staged: true,
    changes: true,
    untracked: true,
  });
  const [changesHeight, setChangesHeight] = usePersistedHeight(
    'mitii.desktop.gitChangesHeight',
    { initial: 420, min: 200, max: 900 },
  );

  const applyStatus = useCallback(
    (next: GitWorkingTreeSnapshot) => {
      setGit(next);
      props.onGitCountChange?.(next.files.length);
      props.onStatusSnapshot?.(next);
    },
    [props.onGitCountChange, props.onStatusSnapshot],
  );

  const loadGit = useCallback(async () => {
    try {
      const next = await fetchGitStatus(auth);
      applyStatus(next);
    } catch (err) {
      props.onError?.(err instanceof Error ? err.message : String(err));
    }
  }, [props.baseUrl, props.token, applyStatus, props.onError]);

  const loadBranches = useCallback(async () => {
    try {
      const next = await fetchGitBranches(auth);
      if (next.ok) setBranches(next.branches);
    } catch {
      /* non-fatal */
    }
  }, [props.baseUrl, props.token]);

  useEffect(() => {
    void loadGit();
    void loadBranches();
  }, [loadGit, loadBranches]);

  const runMutation = async (
    action: () => Promise<{
      ok: boolean;
      error?: string;
      status?: GitWorkingTreeSnapshot;
    }>,
    okNote?: string,
  ) => {
    setBusy(true);
    props.onError?.(null);
    try {
      const result = await action();
      if (result.status) applyStatus(result.status);
      else await loadGit();
      if (!result.ok) {
        props.onError?.(result.error ?? 'git_failed');
        return;
      }
      if (okNote) props.onStatusNote?.(okNote);
      void loadBranches();
    } catch (err) {
      props.onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const generateCommitMessage = async () => {
    setGenBusy(true);
    props.onError?.(null);
    try {
      const compiled = await runRecipe({ ...auth, id: 'commit-message' });
      let text = '';
      for await (const line of streamPrompt({
        ...auth,
        prompt: compiled.compiled.prompt,
        mode: compiled.compiled.mode,
        requiredSkillIds: compiled.compiled.requiredSkillIds,
      })) {
        if (line.op === 'error') {
          throw new Error(line.message ?? line.error);
        }
        const delta = extractAssistantText(line);
        if (delta) text += delta;
        text = finalizeAssistantText(text, line);
      }
      const message = unwrapRecipeAnswer(text);
      if (!message) throw new Error('Empty commit message from model');
      setCommitMessage(message);
      props.onStatusNote?.('Commit message generated');
    } catch (err) {
      props.onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setGenBusy(false);
    }
  };

  const loadWritingRecipe = async (
    id: 'pr-summary' | 'changelog' | 'release-notes',
    userNote?: string,
  ) => {
    setBusy(true);
    props.onError?.(null);
    try {
      const note =
        userNote?.trim() ||
        (id === 'release-notes'
          ? 'Write release notes for the current working-tree changes: user-facing highlights, fixes, and breaking changes.'
          : undefined);
      const recipeId = id === 'release-notes' ? 'changelog' : id;
      const compiled = await runRecipe({
        ...auth,
        id: recipeId,
        ...(note ? { note } : {}),
      });
      // Prefer API `note`; if the engine ignored it, still frame the prompt.
      const prompt =
        note && !compiled.compiled.prompt.includes(note.slice(0, 40))
          ? `${note}\n\n${compiled.compiled.prompt}`
          : compiled.compiled.prompt;
      props.onUsePrompt?.(prompt, compiled.compiled.mode);
      props.onStatusNote?.(
        `Loaded “${id === 'release-notes' ? 'Release notes' : compiled.compiled.title}” into chat`,
      );
    } catch (err) {
      props.onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runCodeReview = async () => {
    setReviewBusy(true);
    setReviewError(null);
    setReviewFindings([]);
    props.onFindingsChange?.([]);
    setReviewStatus('Reviewing…');
    const findings: ReviewFinding[] = [];
    try {
      for await (const line of streamPrompt({
        ...auth,
        prompt: CODE_REVIEW_PROMPT,
        mode: 'agent',
        approvalPreset: 'guided',
        thoroughness: 'medium',
        pinnedPaths: (git?.files ?? []).map((f) => f.path).slice(0, 24),
      })) {
        if (line.op === 'error') {
          throw new Error(line.message ?? line.error);
        }
        if (line.op === 'event') {
          const finding = ingestReviewFinding(line.event);
          if (finding) {
            findings.push(finding);
            setReviewFindings([...findings]);
            props.onFindingsChange?.([...findings]);
            setReviewStatus(
              `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
            );
          }
        }
      }
      setReviewStatus(
        findings.length === 0
          ? 'No findings'
          : `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
      );
      props.onFindingsChange?.(findings);
      void loadGit();
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
      setReviewStatus(null);
    } finally {
      setReviewBusy(false);
    }
  };

  const toggleGroup = (key: keyof typeof openGroups) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderGroup = (
    key: keyof typeof openGroups,
    title: string,
    files: GitWorkingTreeFile[],
    actions: {
      primaryTitle: string;
      primarySymbol: '+' | '−';
      onPrimary: (path: string) => void;
      onPrimaryAll?: () => void;
      dangerTitle?: string;
      onDanger?: (path: string) => void;
    },
  ) => {
    const open = openGroups[key];
    return (
      <section className="scm-group">
        <header className="scm-group__header">
          <button
            type="button"
            className="scm-group__twistie"
            onClick={() => toggleGroup(key)}
            aria-expanded={open}
          >
            {open ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
            <span className="scm-group__title">{title}</span>
            <span className="scm-group__count">{files.length}</span>
          </button>
          {files.length > 0 && actions.onPrimaryAll ? (
            <button
              type="button"
              className="scm-icon-btn"
              disabled={busy}
              title={`${actions.primaryTitle} all`}
              aria-label={`${actions.primaryTitle} all`}
              onClick={actions.onPrimaryAll}
            >
              {actions.primarySymbol === '+' ? (
                <IconPlus size={14} />
              ) : (
                <span className="scm-symbol">−</span>
              )}
            </button>
          ) : null}
        </header>
        {open ? (
          files.length === 0 ? (
            <p className="scm-empty">No {title.toLowerCase()}</p>
          ) : (
            <ul className="scm-resource-list">
              {files.map((file) => {
                const dir = fileDir(file.path);
                const active = props.activePath === `diff:${file.path}`;
                return (
                  <li
                    key={`${file.group}:${file.path}`}
                    className={`scm-resource scm-resource--${gitStatusKind(file.status)}${
                      active ? ' is-active' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="scm-resource__main"
                      onClick={() => void props.onOpenDiff(file.path)}
                      onDoubleClick={() => void props.onOpenFile(file.path)}
                      title={file.path}
                    >
                      <span className="scm-resource__name">
                        {fileLeaf(file.path)}
                      </span>
                      {dir ? (
                        <span className="scm-resource__path">{dir}</span>
                      ) : null}
                    </button>
                    <div className="scm-resource__actions">
                      <button
                        type="button"
                        className="scm-icon-btn"
                        disabled={busy}
                        title={actions.primaryTitle}
                        aria-label={`${actions.primaryTitle} ${file.path}`}
                        onClick={() => actions.onPrimary(file.path)}
                      >
                        {actions.primarySymbol === '+' ? (
                          <IconPlus size={13} />
                        ) : (
                          <span className="scm-symbol">−</span>
                        )}
                      </button>
                      {actions.onDanger && actions.dangerTitle ? (
                        <button
                          type="button"
                          className="scm-icon-btn scm-icon-btn--danger"
                          disabled={busy}
                          title={actions.dangerTitle}
                          aria-label={`${actions.dangerTitle} ${file.path}`}
                          onClick={() => actions.onDanger?.(file.path)}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                    <span
                      className={`scm-resource__decor scm-resource__decor--${gitStatusKind(file.status)}`}
                      title={file.status}
                    >
                      {file.status.trim().slice(0, 1) || 'M'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </section>
    );
  };

  const aheadBehind =
    git?.ahead || git?.behind
      ? [
          git.ahead ? `↑${git.ahead}` : null,
          git.behind ? `↓${git.behind}` : null,
        ]
          .filter(Boolean)
          .join(' ')
      : null;

  const canCommit =
    Boolean(commitMessage.trim()) &&
    (Boolean(git?.staged.length) || commitAll) &&
    !busy;

  return (
    <div className="scm-pane">
      <div
        className="scm-pane__main"
        style={{ flex: `0 0 ${changesHeight}px` }}
      >
        <header className="scm-pane__title">
          <span>Source Control</span>
          <div className="scm-pane__title-actions">
            <button
              type="button"
              className="scm-text-btn"
              disabled={reviewBusy || !(git?.files.length)}
              title="LLM code review"
              onClick={() => void runCodeReview()}
            >
              {reviewBusy ? 'Reviewing…' : 'Review'}
            </button>
            <button
              type="button"
              className="scm-icon-btn"
              title="Refresh"
              aria-label="Refresh"
              disabled={busy}
              onClick={() => {
                void loadGit();
                void loadBranches();
              }}
            >
              <IconRefresh size={15} />
            </button>
          </div>
        </header>

        <div className="scm-input">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Message (Ctrl+Enter to commit)"
            rows={4}
            disabled={busy || genBusy}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) {
                e.preventDefault();
                const message = commitMessage.trim();
                void runMutation(
                  () =>
                    gitCommitChanges({
                      ...auth,
                      message,
                      all: commitAll,
                    }),
                  'Committed',
                ).then(() => {
                  setCommitMessage('');
                  setCommitAll(false);
                });
              }
            }}
          />
          <div className="scm-input__toolbar">
            <label className="scm-check">
              <input
                type="checkbox"
                checked={commitAll}
                disabled={busy}
                onChange={(e) => setCommitAll(e.target.checked)}
              />
              <span>Stage all &amp; commit</span>
            </label>
            <div className="scm-input__toolbar-right">
              <button
                type="button"
                className="scm-text-btn"
                disabled={busy || genBusy || !(git?.files.length)}
                title="Generate commit message"
                onClick={() => void generateCommitMessage()}
              >
                {genBusy ? '…' : 'Generate'}
              </button>
              <button
                type="button"
                className="scm-commit-btn"
                disabled={!canCommit}
                onClick={() => {
                  const message = commitMessage.trim();
                  void runMutation(
                    () =>
                      gitCommitChanges({
                        ...auth,
                        message,
                        all: commitAll,
                      }),
                    'Committed',
                  ).then(() => {
                    setCommitMessage('');
                    setCommitAll(false);
                  });
                }}
              >
                Commit
              </button>
            </div>
          </div>
          <div className="scm-input__recipes">
            <button
              type="button"
              className="scm-text-btn"
              disabled={busy}
              onClick={() => void loadWritingRecipe('pr-summary')}
            >
              PR summary
            </button>
            <button
              type="button"
              className="scm-text-btn"
              disabled={busy}
              onClick={() => void loadWritingRecipe('changelog')}
            >
              Changelog
            </button>
            <button
              type="button"
              className="scm-text-btn"
              disabled={busy}
              onClick={() => void loadWritingRecipe('release-notes')}
            >
              Release notes
            </button>
          </div>
        </div>

        <div className="scm-branch">
          <button
            type="button"
            className="scm-branch__toggle"
            disabled={busy || !git?.ok}
            onClick={() => {
              setBranchOpen((v) => !v);
              if (!branchOpen) void loadBranches();
            }}
            title="Switch or create branch"
          >
            <IconGit size={14} />
            <span className="scm-branch__name">
              {git?.branch ?? 'No repository'}
            </span>
            {aheadBehind ? (
              <span className="scm-branch__sync">{aheadBehind}</span>
            ) : null}
            <span className="scm-branch__caret" aria-hidden>
              {branchOpen ? '▴' : '▾'}
            </span>
          </button>
          {branchOpen ? (
            <div className="scm-branch__menu">
              <div className="scm-branch__create">
                <input
                  value={newBranch}
                  placeholder="Create branch…"
                  disabled={busy}
                  onChange={(e) => setNewBranch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newBranch.trim()) {
                      const name = newBranch.trim();
                      void runMutation(
                        () =>
                          gitCheckoutBranch({
                            ...auth,
                            branch: name,
                            create: true,
                          }),
                        `Created branch ${name}`,
                      ).then(() => {
                        setNewBranch('');
                        setBranchOpen(false);
                      });
                    }
                  }}
                />
                <button
                  type="button"
                  className="scm-text-btn"
                  disabled={busy || !newBranch.trim()}
                  onClick={() => {
                    const name = newBranch.trim();
                    if (!name) return;
                    void runMutation(
                      () =>
                        gitCheckoutBranch({
                          ...auth,
                          branch: name,
                          create: true,
                        }),
                      `Created branch ${name}`,
                    ).then(() => {
                      setNewBranch('');
                      setBranchOpen(false);
                    });
                  }}
                >
                  Create
                </button>
              </div>
              <ul className="scm-branch__list">
                {branches.map((branch) => (
                  <li key={branch}>
                    <button
                      type="button"
                      className={
                        branch === git?.branch ? 'is-current' : undefined
                      }
                      disabled={busy || branch === git?.branch}
                      onClick={() => {
                        void runMutation(
                          () =>
                            gitCheckoutBranch({
                              ...auth,
                              branch,
                            }),
                          `Checked out ${branch}`,
                        ).then(() => setBranchOpen(false));
                      }}
                    >
                      {branch}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="scm-body">
          {renderGroup('staged', 'Staged Changes', git?.staged ?? [], {
            primaryTitle: 'Unstage',
            primarySymbol: '−',
            onPrimary: (path) => {
              void runMutation(() =>
                gitUnstageFiles({ ...auth, paths: [path] }),
              );
            },
            onPrimaryAll: () => {
              void runMutation(() => gitUnstageFiles({ ...auth }));
            },
          })}
          {renderGroup('changes', 'Changes', git?.changes ?? [], {
            primaryTitle: 'Stage',
            primarySymbol: '+',
            onPrimary: (path) => {
              void runMutation(() =>
                gitStageFiles({ ...auth, paths: [path] }),
              );
            },
            onPrimaryAll: () => {
              void runMutation(() =>
                gitStageFiles({
                  ...auth,
                  paths: (git?.changes ?? []).map((f) => f.path),
                }),
              );
            },
            dangerTitle: 'Discard',
            onDanger: (path) => {
              if (!window.confirm(`Discard changes to ${path}?`)) return;
              void runMutation(() =>
                gitDiscardFiles({ ...auth, paths: [path] }),
              );
            },
          })}
          {renderGroup('untracked', 'Untracked', git?.untracked ?? [], {
            primaryTitle: 'Stage',
            primarySymbol: '+',
            onPrimary: (path) => {
              void runMutation(() =>
                gitStageFiles({ ...auth, paths: [path] }),
              );
            },
            onPrimaryAll: () => {
              void runMutation(() =>
                gitStageFiles({
                  ...auth,
                  paths: (git?.untracked ?? []).map((f) => f.path),
                }),
              );
            },
            dangerTitle: 'Delete',
            onDanger: (path) => {
              if (
                !window.confirm(`Permanently delete untracked file ${path}?`)
              ) {
                return;
              }
              void runMutation(() =>
                gitDiscardFiles({
                  ...auth,
                  paths: [path],
                  includeUntracked: true,
                }),
              );
            },
          })}

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

      <ResizeHandle
        orientation="horizontal"
        value={changesHeight}
        onChange={setChangesHeight}
        min={200}
        max={900}
        label="Resize source control and review"
      />

      <div className="scm-pane__review">
        <header className="scm-pane__title scm-pane__title--sub">
          <span>Code Review</span>
          {reviewStatus ? (
            <span className="scm-review-status">{reviewStatus}</span>
          ) : null}
        </header>
        {reviewError ? (
          <p className="scm-empty scm-empty--error">{reviewError}</p>
        ) : null}
        <div className="scm-review-list">
          {reviewFindings.length === 0 && !reviewBusy ? (
            <p className="scm-empty">
              Run Review to analyze working-tree changes.
            </p>
          ) : null}
          {reviewFindings.map((finding, i) => (
            <button
              key={`${finding.path}:${finding.startLine ?? 0}:${i}`}
              type="button"
              className={`scm-finding scm-finding--${finding.severity}`}
              onClick={() => void props.onOpenDiff(finding.path)}
              title={finding.path}
            >
              <span className="scm-finding__sev">{finding.severity}</span>
              <span className="scm-finding__path">
                {finding.path}
                {finding.startLine ? `:${finding.startLine}` : ''}
              </span>
              <span className="scm-finding__msg">{finding.content}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
