import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CODE_REVIEW_PROMPT,
  ingestReviewFinding,
  type ReviewFinding,
} from '../../../shared/reviewFindings.js';
import {
  extractAssistantText,
  fetchWorkspaceFile,
  finalizeAssistantText,
  runRecipe,
  streamPrompt,
} from '../../api.js';
import { mergeChangelogSection, unwrapRecipeAnswer } from '../changelogMerge.js';
import type { ScmAuth, ScmJob } from '../scmTypes.js';
import { upsertWorkspaceMarkdown } from '../upsertWorkspaceMarkdown.js';

export interface UseScmJobsOptions {
  auth: ScmAuth;
  showCodeReview: boolean;
  /** Paths pinned into the Code Review prompt. */
  reviewPaths: readonly string[];
  loadGit: () => Promise<void>;
  setCommitMessage: (message: string) => void;
  onOpenFile: (path: string) => void | Promise<void>;
  onStatusNote?: (note: string | null) => void;
  onError?: (error: string | null) => void;
  onFindingsChange?: (findings: ReviewFinding[]) => void;
}

const isAbort = (err: unknown): boolean =>
  err instanceof Error && /abort/i.test(err.message);

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export function useScmJobs(opts: UseScmJobsOptions) {
  const {
    auth,
    showCodeReview,
    reviewPaths,
    loadGit,
    setCommitMessage,
    onOpenFile,
    onStatusNote,
    onError,
    onFindingsChange,
  } = opts;
  const [activeJob, setActiveJob] = useState<ScmJob | null>(null);
  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (showCodeReview) return;
    setReviewFindings([]);
    setReviewError(null);
    onFindingsChange?.([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCodeReview]);

  const stopJob = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setActiveJob(null);
    onStatusNote?.('Stopped');
    window.setTimeout(() => onStatusNote?.(null), 1200);
  }, [onStatusNote]);

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

  const streamRecipeText = async (
    job: ScmJob,
    recipeId: 'commit-message' | 'pr-summary' | 'changelog',
    note?: string,
  ): Promise<string> => {
    const controller = beginJob(job);
    onError?.(null);
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

  const reportFailure = (err: unknown) => {
    if (isAbort(err)) return;
    onError?.(errMessage(err));
  };

  const generateCommitMessage = async () => {
    try {
      const message = await streamRecipeText('commit-message', 'commit-message');
      if (!message) throw new Error('Empty commit message from model');
      setCommitMessage(message);
      onStatusNote?.('Commit message generated');
    } catch (err) {
      reportFailure(err);
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
      onStatusNote?.(existing ? 'Updated CHANGELOG.md' : 'Created CHANGELOG.md');
      void loadGit();
      void onOpenFile('CHANGELOG.md');
    } catch (err) {
      reportFailure(err);
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
      onStatusNote?.('Wrote RELEASE-NOTES.md');
      void loadGit();
      void onOpenFile('RELEASE-NOTES.md');
    } catch (err) {
      reportFailure(err);
    }
  };

  const runPrSummary = async () => {
    try {
      const text = await streamRecipeText('pr-summary', 'pr-summary');
      if (!text) throw new Error('Empty PR summary from model');
      await navigator.clipboard.writeText(text);
      onStatusNote?.('PR summary copied — paste into Create PR when ready');
    } catch (err) {
      reportFailure(err);
    }
  };

  const runCodeReview = async () => {
    const controller = beginJob('code-review');
    setReviewError(null);
    setReviewFindings([]);
    onFindingsChange?.([]);
    const findings: ReviewFinding[] = [];
    try {
      for await (const line of streamPrompt({
        ...auth,
        prompt: CODE_REVIEW_PROMPT,
        mode: 'agent',
        approvalPreset: 'guided',
        thoroughness: 'medium',
        pinnedPaths: reviewPaths.slice(0, 24),
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
            onFindingsChange?.([...findings]);
          }
        }
      }
      onFindingsChange?.(findings);
      void loadGit();
    } catch (err) {
      if (isAbort(err)) return;
      setReviewError(errMessage(err));
    } finally {
      endJob(controller);
    }
  };

  return {
    activeJob,
    reviewFindings,
    reviewError,
    stopJob,
    generateCommitMessage,
    runChangelogUpdate,
    runReleaseNotes,
    runPrSummary,
    runCodeReview,
  };
}
