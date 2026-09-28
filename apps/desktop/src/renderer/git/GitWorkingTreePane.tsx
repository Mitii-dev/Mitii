/**
 * Agent Working Tree pane — VS Code–style SCM layout (commit, recipes).
 * Branch switching lives in the top bar beside Workspace.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  IconStop,
} from '../ActivityIcons.js';
import {
  createWorkspaceFilePath,
  extractAssistantText,
  fetchGitStatus,
  fetchWorkspaceFile,
  finalizeAssistantText,
  gitCommitChanges,
  gitDiscardFiles,
  gitStageFiles,
  gitStashFiles,
  gitUnstageFiles,
  runRecipe,
  saveWorkspaceFile,
  streamPrompt,
} from '../api.js';
import { gitStatusKind } from '../explorer/DiffView.js';
import { ResizeHandle, usePersistedHeight } from '../shell/ResizeHandle.js';
import { mergeChangelogSection, unwrapRecipeAnswer } from './changelogMerge.js';

type ScmGroupKey = 'staged' | 'changes';

type ScmJob =
  | 'commit-message'
  | 'changelog'
  | 'release-notes'
  | 'pr-summary'
  | 'code-review';

const JOB_LABEL: Record<ScmJob, string> = {
  'commit-message': 'Commit message',
  changelog: 'Changelog',
  'release-notes': 'Release notes',
  'pr-summary': 'PR summary',
  'code-review': 'Code Review',
};

type ContextMenuState = {
  x: number;
  y: number;
  paths: string[];
};

function fileLeaf(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

function fileDir(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i <= 0 ? '' : norm.slice(0, i);
}

async function upsertWorkspaceMarkdown(
  auth: { baseUrl: string; token?: string },
  relPath: string,
  content: string,
): Promise<void> {
  try {
    await saveWorkspaceFile({ ...auth, path: relPath, content });
  } catch {
    const slash = relPath.lastIndexOf('/');
    const parent = slash >= 0 ? relPath.slice(0, slash) : '';
    const name = slash >= 0 ? relPath.slice(slash + 1) : relPath;
    await createWorkspaceFilePath({
      ...auth,
      parent,
      name,
      content,
    });
  }
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
  const [activeJob, setActiveJob] = useState<ScmJob | null>(null);
  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState({
    staged: true,
    changes: true,
  });
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [selectionGroup, setSelectionGroup] = useState<ScmGroupKey | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
    null,
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [changesHeight, setChangesHeight] = usePersistedHeight(
    'mitii.desktop.gitChangesHeight',
    { initial: 420, min: 200, max: 900 },
  );

  const changeFiles = useMemo(() => {
    const dirty = git?.changes ?? [];
    const untracked = git?.untracked ?? [];
    return [...dirty, ...untracked].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
  }, [git?.changes, git?.untracked]);

  const untrackedPathSet = useMemo(
    () => new Set((git?.untracked ?? []).map((f) => f.path)),
    [git?.untracked],
  );

  const fileByPath = useMemo(() => {
    const map = new Map<string, GitWorkingTreeFile>();
    for (const f of git?.files ?? []) map.set(f.path, f);
    return map;
  }, [git?.files]);

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

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

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

  const stopJob = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setActiveJob(null);
    props.onStatusNote?.('Stopped');
    window.setTimeout(() => props.onStatusNote?.(null), 1200);
  }, [props.onStatusNote]);

  const beginJob = (job: ScmJob) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setActiveJob(job);
    return controller;
  };

  const endJob = (controller: AbortController) => {
    if (abortRef.current === controller) {
      abortRef.current = null;
      setActiveJob(null);
    }
  };

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

  const streamRecipeText = async (
    job: ScmJob,
    recipeId: 'commit-message' | 'pr-summary' | 'changelog',
    note?: string,
  ): Promise<string> => {
    const controller = beginJob(job);
    props.onError?.(null);
    try {
      const compiled = await runRecipe({
        ...auth,
        id: recipeId,
        ...(note ? { note } : {}),
      });
      const prompt =
        note && !compiled.compiled.prompt.includes(note.slice(0, 40))
          ? `${note}\n\n${compiled.compiled.prompt}`
          : compiled.compiled.prompt;
      let text = '';
      for await (const line of streamPrompt({
        ...auth,
        prompt,
        mode: compiled.compiled.mode,
        requiredSkillIds: compiled.compiled.requiredSkillIds,
        signal: controller.signal,
      })) {
        if (line.op === 'error') {
          throw new Error(line.message ?? line.error);
        }
        const delta = extractAssistantText(line);
        if (delta) text += delta;
        text = finalizeAssistantText(text, line);
      }
      return unwrapRecipeAnswer(text);
    } finally {
      endJob(controller);
    }
  };

  const generateCommitMessage = async () => {
    try {
      const message = await streamRecipeText(
        'commit-message',
        'commit-message',
      );
      if (!message) throw new Error('Empty commit message from model');
      setCommitMessage(message);
      props.onStatusNote?.('Commit message generated');
    } catch (err) {
      if (err instanceof Error && /abort/i.test(err.message)) return;
      props.onError?.(err instanceof Error ? err.message : String(err));
    }
  };

  const runChangelogUpdate = async () => {
    try {
      const section = await streamRecipeText(
        'changelog',
        'changelog',
        'Draft a Keep a Changelog section for the current working-tree changes. Final reply must be ONLY the markdown section.',
      );
      if (!section) throw new Error('Empty changelog from model');

      let existing: string | null = null;
      try {
        const file = await fetchWorkspaceFile({
          ...auth,
          path: 'CHANGELOG.md',
        });
        existing = file.content;
      } catch {
        existing = null;
      }

      const next = mergeChangelogSection(existing, section);
      await upsertWorkspaceMarkdown(auth, 'CHANGELOG.md', next);
      props.onStatusNote?.(
        existing ? 'Updated CHANGELOG.md' : 'Created CHANGELOG.md',
      );
      void loadGit();
      void props.onOpenFile('CHANGELOG.md');
    } catch (err) {
      if (err instanceof Error && /abort/i.test(err.message)) return;
      props.onError?.(err instanceof Error ? err.message : String(err));
    }
  };

  const runReleaseNotes = async () => {
    try {
      const section = await streamRecipeText(
        'release-notes',
        'changelog',
        'Frame as release notes: summary highlights, breaking changes, and upgrade notes as a Keep a Changelog section. Final reply must be ONLY the markdown.',
      );
      if (!section) throw new Error('Empty release notes from model');
      const content = `# Release notes\n\n${section.trim()}\n`;
      await upsertWorkspaceMarkdown(auth, 'RELEASE-NOTES.md', content);
      props.onStatusNote?.('Wrote RELEASE-NOTES.md');
      void loadGit();
      void props.onOpenFile('RELEASE-NOTES.md');
    } catch (err) {
      if (err instanceof Error && /abort/i.test(err.message)) return;
      props.onError?.(err instanceof Error ? err.message : String(err));
    }
  };

  const runPrSummary = async () => {
    try {
      const text = await streamRecipeText('pr-summary', 'pr-summary');
      if (!text) throw new Error('Empty PR summary from model');
      await navigator.clipboard.writeText(text);
      props.onStatusNote?.(
        'PR summary copied — paste into Create PR when ready',
      );
    } catch (err) {
      if (err instanceof Error && /abort/i.test(err.message)) return;
      props.onError?.(err instanceof Error ? err.message : String(err));
    }
  };

  const runCodeReview = async () => {
    const controller = beginJob('code-review');
    setReviewError(null);
    setReviewFindings([]);
    props.onFindingsChange?.([]);
    const findings: ReviewFinding[] = [];
    try {
      for await (const line of streamPrompt({
        ...auth,
        prompt: CODE_REVIEW_PROMPT,
        mode: 'agent',
        approvalPreset: 'guided',
        thoroughness: 'medium',
        pinnedPaths: (git?.files ?? []).map((f) => f.path).slice(0, 24),
        signal: controller.signal,
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
          }
        }
      }
      props.onFindingsChange?.(findings);
      void loadGit();
    } catch (err) {
      if (err instanceof Error && /abort/i.test(err.message)) return;
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      endJob(controller);
    }
  };

  const openContextMenu = (
    e: ReactMouseEvent,
    group: ScmGroupKey,
    files: GitWorkingTreeFile[],
    path: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    let paths: string[];
    if (selectedPaths.has(path) && selectedPaths.size > 1) {
      const groupPaths = new Set(files.map((f) => f.path));
      paths = [...selectedPaths].filter((p) => groupPaths.has(p));
      if (paths.length === 0) paths = [path];
    } else {
      paths = [path];
      setSelectedPaths(new Set([path]));
      setSelectionAnchor(path);
      setSelectionGroup(group);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, paths });
  };

  const menuPaths = contextMenu?.paths ?? [];
  const menuHasStaged = menuPaths.some(
    (p) => fileByPath.get(p)?.group === 'staged',
  );
  const menuHasUnstaged = menuPaths.some((p) => {
    const g = fileByPath.get(p)?.group;
    return g === 'changes' || g === 'untracked';
  });
  const menuHasUntracked = menuPaths.some((p) => untrackedPathSet.has(p));

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
              disabled={busy || Boolean(activeJob)}
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
                    onContextMenu={(e) =>
                      openContextMenu(e, key, files, file.path)
                    }
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
                        <span
                          className="scm-resource__rename"
                          title={file.renameFrom}
                        >
                          ← {fileLeaf(file.renameFrom)}
                        </span>
                      ) : null}
                    </button>
                    <div className="scm-resource__actions">
                      <button
                        type="button"
                        className="scm-icon-btn"
                        disabled={busy || Boolean(activeJob)}
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
                          disabled={busy || Boolean(activeJob)}
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

  const jobRunning = Boolean(activeJob);
  const canCommit =
    Boolean(commitMessage.trim()) &&
    Boolean(git?.staged.length) &&
    !busy &&
    !jobRunning;

  const findingsCount = reviewFindings.length;
  const codeReviewLabel =
    findingsCount > 0 ? `Code Review (${findingsCount})` : 'Code Review';

  const doCommit = () => {
    const message = commitMessage.trim();
    void runMutation(
      () =>
        gitCommitChanges({
          ...auth,
          message,
        }),
      'Committed',
    ).then(() => {
      setCommitMessage('');
    });
  };

  return (
    <div className="scm-pane">
      <div
        className="scm-pane__main"
        style={{ flex: `0 0 ${changesHeight}px` }}
      >
        <header className="scm-pane__title">
          <span className="scm-pane__title-left">
            <span>
              Source Control
              {git?.ok && (git.changeCount ?? git.files.length) > 0 ? (
                <span className="scm-pane__badge" title="Changed files">
                  {git.changeCount ?? git.files.length}
                </span>
              ) : null}
            </span>
            {activeJob ? (
              <span className="scm-pane__running" aria-live="polite">
                {JOB_LABEL[activeJob]}…
              </span>
            ) : null}
          </span>
          <div className="scm-pane__title-actions">
            {activeJob ? (
              <button
                type="button"
                className="scm-icon-btn scm-icon-btn--stop"
                title={`Stop ${JOB_LABEL[activeJob]}`}
                aria-label={`Stop ${JOB_LABEL[activeJob]}`}
                onClick={stopJob}
              >
                <IconStop size={13} />
              </button>
            ) : null}
            <button
              type="button"
              className="scm-text-btn"
              disabled={jobRunning || !(git?.files.length)}
              title="LLM code review of working-tree changes"
              onClick={() => void runCodeReview()}
            >
              {activeJob === 'code-review' ? 'Code Review…' : codeReviewLabel}
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
            disabled={busy || jobRunning}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) {
                e.preventDefault();
                doCommit();
              }
            }}
          />
          <div className="scm-input__toolbar">
            <div className="scm-input__toolbar-right">
              <button
                type="button"
                className="scm-text-btn"
                disabled={busy || jobRunning || !(git?.files.length)}
                title="Generate commit message"
                onClick={() => void generateCommitMessage()}
              >
                {activeJob === 'commit-message' ? '…' : 'Generate'}
              </button>
              <button
                type="button"
                className="scm-commit-btn"
                disabled={!canCommit}
                onClick={doCommit}
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
              onClick={() => void runChangelogUpdate()}
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
                      void runPrSummary();
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
                      void runReleaseNotes();
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

        <div
          className="scm-body"
          tabIndex={0}
          onKeyDown={(e) => {
            if (
              e.target instanceof HTMLInputElement ||
              e.target instanceof HTMLTextAreaElement
            ) {
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
              void runMutation(() => gitUnstageFiles({ ...auth, paths }));
            },
            onPrimaryAll: () => {
              void runMutation(() => gitUnstageFiles({ ...auth }));
            },
          })}
          {renderGroup('changes', 'Changes', changeFiles, {
            primaryTitle: 'Stage',
            primarySymbol: '+',
            onPrimary: (paths) => {
              void runMutation(() => gitStageFiles({ ...auth, paths }));
            },
            onPrimaryAll: () => {
              void runMutation(() =>
                gitStageFiles({
                  ...auth,
                  paths: changeFiles.map((f) => f.path),
                }),
              );
            },
            dangerTitle: 'Discard',
            onDanger: (paths) => {
              const hasJunk = paths.some((p) => untrackedPathSet.has(p));
              const label =
                paths.length === 1 ? paths[0] : `${paths.length} files`;
              const verb = hasJunk ? 'Discard / delete' : 'Discard changes to';
              if (!window.confirm(`${verb} ${label}?`)) return;
              void runMutation(() =>
                gitDiscardFiles({
                  ...auth,
                  paths,
                  includeUntracked: hasJunk,
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
          <span>
            {findingsCount > 0
              ? `Code Review (${findingsCount})`
              : 'Code Review'}
          </span>
          {activeJob === 'code-review' ? (
            <span className="scm-review-status">Running…</span>
          ) : findingsCount === 0 && !reviewError ? (
            <span className="scm-review-status">No findings yet</span>
          ) : null}
        </header>
        {reviewError ? (
          <p className="scm-empty scm-empty--error">{reviewError}</p>
        ) : null}
        <div className="scm-review-list">
          {findingsCount === 0 && activeJob !== 'code-review' ? (
            <p className="scm-empty">
              Run Code Review to analyze working-tree changes. Findings appear
              here.
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
              <div className="scm-finding__meta">
                <span className="scm-finding__sev">{finding.severity}</span>
                {finding.category ? (
                  <span className="scm-finding__cat">{finding.category}</span>
                ) : null}
              </div>
              <span className="scm-finding__path">
                {finding.path}
                {finding.startLine ? `:${finding.startLine}` : ''}
              </span>
              <span className="scm-finding__msg">{finding.content}</span>
              {finding.existingCode ? (
                <pre className="scm-finding__code">{finding.existingCode}</pre>
              ) : null}
              {finding.suggestionCode ? (
                <pre className="scm-finding__code scm-finding__code--suggest">
                  {finding.suggestionCode}
                </pre>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {contextMenu ? (
        <div
          className="explorer-menu scm-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!menuHasUnstaged || busy || jobRunning}
            onClick={() => {
              const paths = menuPaths.filter((p) => {
                const g = fileByPath.get(p)?.group;
                return g === 'changes' || g === 'untracked';
              });
              setContextMenu(null);
              if (paths.length === 0) return;
              void runMutation(() => gitStageFiles({ ...auth, paths }));
            }}
          >
            Stage
            {menuPaths.length > 1 ? ` (${menuPaths.length})` : ''}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!menuHasStaged || busy || jobRunning}
            onClick={() => {
              const paths = menuPaths.filter(
                (p) => fileByPath.get(p)?.group === 'staged',
              );
              setContextMenu(null);
              if (paths.length === 0) return;
              void runMutation(() => gitUnstageFiles({ ...auth, paths }));
            }}
          >
            Unstage
            {menuPaths.length > 1 ? ` (${menuPaths.length})` : ''}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={menuPaths.length === 0 || busy || jobRunning}
            onClick={() => {
              const paths = [...menuPaths];
              setContextMenu(null);
              if (paths.length === 0) return;
              void runMutation(
                () =>
                  gitStashFiles({
                    ...auth,
                    paths,
                    includeUntracked: menuHasUntracked,
                  }),
                `Stashed ${paths.length} path${paths.length === 1 ? '' : 's'}`,
              );
            }}
          >
            Stash
            {menuPaths.length > 1 ? ` (${menuPaths.length})` : ''}
          </button>
        </div>
      ) : null}
    </div>
  );
}
