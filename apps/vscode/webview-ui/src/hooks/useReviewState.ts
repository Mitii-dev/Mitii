import { useCallback, useRef, useState } from 'react';
import { postToHost } from '../bridge';
import { type ReviewDiffView, type RunFileChangesView } from '../protocol';
import type { RunStreamApi } from './useRunStream';

export function useReviewState(deps: RunStreamApi) {
  const {
    setTurns,
  } = deps;

  const [codeReviewRunning, setCodeReviewRunning] = useState(false);
  const codeReviewRunningRef = useRef(false);
  /** Git file fingerprint from the last completed code review; blocks re-run until dismiss or new files. */
  const [codeReviewFileKey, setCodeReviewFileKey] = useState<string | null>(
    null,
  );

  const [review, setReview] = useState<ReviewDiffView | null>(null);
  const reviewRef = useRef<ReviewDiffView | null>(null);
  reviewRef.current = review;
  const [reviewFindings, setReviewFindings] = useState<
    Array<{
      path: string;
      content: string;
      startLine?: number;
      endLine?: number;
      severity: string;
      category?: string;
      existingCode?: string;
      suggestionCode?: string;
      status?: 'open' | 'fixed';
    }>
  >([]);
  const [reviewBarExpandToken, setReviewBarExpandToken] = useState(0);
  const pendingAutoReviewRef = useRef<{ prompt?: string } | null>(null);
  const runReviewRef = useRef<((promptOverride?: string) => void) | null>(
    null,
  );

  const showGitChanges = useCallback(() => {
    setReviewBarExpandToken((n) => n + 1);
    postToHost({ type: 'refreshReviewDiff' });
  }, []);

  const openFile = useCallback(
    (path: string, line?: number, column?: number) => {
      postToHost({ type: 'openFile', path, line, column });
    },
    [],
  );

  const undoFileChanges = useCallback((runId: string) => {
    postToHost({ type: 'undoFileChanges', runId });
  }, []);

  const reviewFileChange = useCallback((runId: string, path: string) => {
    postToHost({ type: 'reviewFileChange', runId, path });
  }, []);

  const reviewAllFileChanges = useCallback((changes: RunFileChangesView) => {
    setReviewBarExpandToken((n) => n + 1);
    postToHost({ type: 'refreshReviewDiff' });
    for (const file of changes.files.slice(0, 1)) {
      postToHost({
        type: 'reviewFileChange',
        runId: changes.runId,
        path: file.path,
      });
    }
  }, []);

  const dismissFileChanges = useCallback((runId: string) => {
    postToHost({ type: 'dismissFileChanges', runId });
    setTurns((prev) =>
      prev.map((t) =>
        t.fileChanges?.runId === runId
          ? { ...t, fileChanges: undefined }
          : t,
      ),
    );
  }, []);

  const dismissReviewFindings = useCallback(() => {
    setReviewFindings([]);
    setCodeReviewFileKey(null);
    postToHost({ type: 'dismissReviewFindings' });
  }, []);

  return {
    codeReviewRunning,
    setCodeReviewRunning,
    codeReviewRunningRef,
    codeReviewFileKey,
    setCodeReviewFileKey,
    review,
    setReview,
    reviewRef,
    reviewFindings,
    setReviewFindings,
    reviewBarExpandToken,
    setReviewBarExpandToken,
    pendingAutoReviewRef,
    runReviewRef,
    showGitChanges,
    openFile,
    undoFileChanges,
    reviewFileChange,
    reviewAllFileChanges,
    dismissFileChanges,
    dismissReviewFindings,
  };
}

export type ReviewStateApi = ReturnType<typeof useReviewState>;
