/**
 * Agent Working Tree pane — VS Code–style SCM layout (commit, recipes).
 * Branch switching lives in the top bar beside Workspace.
 */

import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type {
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
} from '../../shared/git/workingTree.js';
import {
  CODE_REVIEW_PROMPT,
  ingestReviewFinding,
  type ReviewFinding,
} from '../../shared/reviewFindings.js';
import {
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconRefresh,
} from '../ActivityIcons.js';
import {
  extractAssistantText,
  fetchGitStatus,
  finalizeAssistantText,
  gitCommitChanges,
  gitDiscardFiles,
  gitStageFiles,
  gitUnstageFiles,
  runRecipe,
  streamPrompt,
} from '../api.js';
import { gitStatusKind } from '../explorer/DiffView.js';
import { ResizeHandle, usePersistedHeight } from '../shell/ResizeHandle.js';

type ScmGroupKey = 'staged' | 'changes' | 'untracked';

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
  /** Increment to force an immediate status reload (agent / FS changes). */
  refreshToken?: number;
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
  const [commitAll, setCommitAll] = useState(false);
  const [openGroups, setOpenGroups] = useState({
    staged: true,
    changes: true,
    untracked: true,
  });
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [selectionGroup, setSelectionGroup] = useState<ScmGroupKey | null>(
    null,
  );
  const [changesHeight, setChangesHeight] = usePersistedHeight(
    'mitii.desktop.gitChangesHeight',
    { initial: 420, min: 200, max: 900 },
  );

  const applyStatus = useCallback(
    (next: GitWorkingTreeSnapshot) => {
      setGit(next);
      const valid = new Set(next.files.map((f) => f.path));
      setSelectedPaths((prev) => {
        const pruned = [...prev].filter((p) => valid.has(p));
        if (pruned.length === prev.size) return prev;
        return new Set(pruned);
      });
      props.onGitCountChange?.(next.changeCount ?? next.files.length);
      props.onStatusSnapshot?.(next);
    },
    [props.onGitCountChange, props.onStatusSnapshot],
  );

  const pathsForAction = (path: string, files: GitWorkingTreeFile[]) => {
    const groupPaths = new Set(files.map((f) => f.path));
    if (selectedPaths.has(path) && selectedPaths.size > 1) {
      const multi = [...selectedPaths].filter((p) => groupPaths.has(p));
      if (multi.length > 0) return multi;
    }
    return [path];
  };

  const selectInGroup = (
    group: ScmGroupKey,
    files: GitWorkingTreeFile[],
    path: string,
    e: ReactMouseEvent,
  ) => {
    const multi = e.metaKey || e.ctrlKey;
    const range = e.shiftKey;
    const paths = files.map((f) => f.path);

    if (range && selectionAnchor && selectionGroup === group) {
      const a = paths.indexOf(selectionAnchor);
      const b = paths.indexOf(path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedPaths(new Set(paths.slice(lo, hi + 1)));
        return;
      }
    }

    if (multi) {
      setSelectedPaths((prev) => {
        const next = new Set(selectionGroup === group ? prev : []);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setSelectionAnchor(path);
      setSelectionGroup(group);
      return;
    }

    setSelectedPaths(new Set([path]));
    setSelectionAnchor(path);
    setSelectionGroup(group);
  };

  const loadGit = useCallback(async () => {
    try {
      const next = await fetchGitStatus(auth);
      applyStatus(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/failed to fetch|networkerror|load failed/i.test(msg)) return;
      props.onError?.(msg);
    }
  }, [props.baseUrl, props.token, applyStatus, props.onError]);

  useEffect(() => {
    void loadGit();
  }, [loadGit]);

  useEffect(() => {
    if (!props.refreshToken) return;
    void loadGit();
  }, [props.refreshToken, loadGit]);

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
    key: ScmGroupKey,
    title: string,
    files: GitWorkingTreeFile[],
    actions: {
      primaryTitle: string;
      primarySymbol: '+' | '−';
      onPrimary: (paths: string[]) => void;
      onPrimaryAll?: () => void;
      dangerTitle?: string;
      onDanger?: (paths: string[]) => void;
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
                const selected = selectedPaths.has(file.path);
                return (
                  <li
                    key={`${file.group}:${file.path}`}
                    className={`scm-resource scm-resource--${gitStatusKind(file.status)}${
                      active ? ' is-active' : ''
                    }${selected ? ' is-selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="scm-resource__main"
                      onClick={(e) => {
                        const multi = e.metaKey || e.ctrlKey || e.shiftKey;
                        selectInGroup(key, files, file.path, e);
                        if (!multi) void props.onOpenDiff(file.path);
                      }}
                      onDoubleClick={() => void props.onOpenFile(file.path)}
                      title={
                        file.renameFrom
                          ? `${file.renameFrom} → ${file.path}`
                          : file.path
                      }
                    >
                      <span className="scm-resource__name">
                        {fileLeaf(file.path)}
                      </span>
                      {dir ? (
                        <span className="scm-resource__path">{dir}</span>
                      ) : null}
                      {file.renameFrom ? (
                        <span className="scm-resource__rename" title={file.renameFrom}>
                          ← {fileLeaf(file.renameFrom)}
                        </span>
                      ) : null}
                    </button>
                    <div className="scm-resource__actions">
                      <button
                        type="button"
                        className="scm-icon-btn"
                        disabled={busy}
                        title={
                          selected && selectedPaths.size > 1
                            ? `${actions.primaryTitle} selected`
                            : actions.primaryTitle
                        }
                        aria-label={`${actions.primaryTitle} ${file.path}`}
                        onClick={() =>
                          actions.onPrimary(pathsForAction(file.path, files))
                        }
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
                          title={
                            selected && selectedPaths.size > 1
                              ? `${actions.dangerTitle} selected`
                              : actions.dangerTitle
                          }
                          aria-label={`${actions.dangerTitle} ${file.path}`}
                          onClick={() =>
                            actions.onDanger?.(
                              pathsForAction(file.path, files),
                            )
                          }
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                    <span
                      className={`scm-resource__decor scm-resource__decor--${gitStatusKind(file.status)}`}
                      title={file.status}
                    >
                      {file.status.trim().slice(0, 1) ||
                        (file.group === 'untracked' ? 'U' : 'M')}
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
          <span>
            Source Control
            {git?.ok && (git.changeCount ?? git.files.length) > 0 ? (
              <span className="scm-pane__badge" title="Changed files">
                {git.changeCount ?? git.files.length}
              </span>
            ) : null}
          </span>
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

        <div
          className="scm-body"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
              return;
            }
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
              setSelectedPaths(new Set());
              setSelectionAnchor(null);
              setSelectionGroup(null);
            }
          }}
        >
          {renderGroup('staged', 'Staged Changes', git?.staged ?? [], {
            primaryTitle: 'Unstage',
            primarySymbol: '−',
            onPrimary: (paths) => {
              void runMutation(() =>
                gitUnstageFiles({ ...auth, paths }),
              );
            },
            onPrimaryAll: () => {
              void runMutation(() => gitUnstageFiles({ ...auth }));
            },
          })}
          {renderGroup('changes', 'Changes', git?.changes ?? [], {
            primaryTitle: 'Stage',
            primarySymbol: '+',
            onPrimary: (paths) => {
              void runMutation(() =>
                gitStageFiles({ ...auth, paths }),
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
            onDanger: (paths) => {
              const label =
                paths.length === 1
                  ? paths[0]
                  : `${paths.length} files`;
              if (!window.confirm(`Discard changes to ${label}?`)) return;
              void runMutation(() =>
                gitDiscardFiles({ ...auth, paths }),
              );
            },
          })}
          {renderGroup('untracked', 'Untracked Files', git?.untracked ?? [], {
            primaryTitle: 'Stage',
            primarySymbol: '+',
            onPrimary: (paths) => {
              void runMutation(() =>
                gitStageFiles({ ...auth, paths }),
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
            onDanger: (paths) => {
              const label =
                paths.length === 1
                  ? paths[0]
                  : `${paths.length} untracked files`;
              if (
                !window.confirm(`Permanently delete ${label}?`)
              ) {
                return;
              }
              void runMutation(() =>
                gitDiscardFiles({
                  ...auth,
                  paths,
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
