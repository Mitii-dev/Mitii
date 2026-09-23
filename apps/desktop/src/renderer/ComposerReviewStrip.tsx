/**
 * WIRING.md — App.tsx
 * - import { ComposerReviewStrip } from './ComposerReviewStrip.js'
 * - Mount above composer when latest run has file changes and/or review findings:
 *   <ComposerReviewStrip
 *     findings={reviewFindings}
 *     fileChangeCount={latestRunChanges?.files.length ?? 0}
 *     runId={latestRunChanges?.runId}
 *     running={busy}
 *     codeReviewEnabled={settings.features?.codeReview !== false}
 *     onShowChanges={…} onRunCodeReview={…}
 *     onUndoChanges={…} onFixAll={…} onDismiss={…}
 *   />
 * - Findings: use ReviewFinding from shared/reviewFindings.ts (+ optional status).
 */

import {
  WorkingTreeReviewBar,
  type ReviewFindingChip,
  type RunFileChangesSummary,
} from './WorkingTreeReviewBar.js';

export type { ReviewFindingChip, RunFileChangesSummary };

export interface ComposerReviewStripProps {
  findings: readonly ReviewFindingChip[];
  /** Count of files touched by the latest Mitii run. */
  fileChangeCount: number;
  runId?: string;
  running?: boolean;
  codeReviewEnabled?: boolean;
  onShowChanges: () => void;
  onRunCodeReview?: () => void;
  onUndoChanges?: (runId: string) => void;
  onFixAll?: () => void;
  onDismiss?: (runId?: string) => void;
}

export function ComposerReviewStrip({
  findings,
  fileChangeCount,
  runId,
  running = false,
  codeReviewEnabled = false,
  onShowChanges,
  onRunCodeReview,
  onUndoChanges,
  onFixAll,
  onDismiss,
}: ComposerReviewStripProps) {
  const runChanges: RunFileChangesSummary | null =
    runId && fileChangeCount > 0
      ? { runId, fileCount: fileChangeCount }
      : null;

  return (
    <WorkingTreeReviewBar
      fileChangeCount={fileChangeCount}
      findings={findings}
      running={running}
      codeReviewEnabled={codeReviewEnabled}
      runChanges={runChanges}
      onShowChanges={onShowChanges}
      onRunCodeReview={codeReviewEnabled ? onRunCodeReview : undefined}
      onUndoChanges={
        runId && onUndoChanges ? () => onUndoChanges(runId) : undefined
      }
      onFixAll={onFixAll}
      onDismiss={
        onDismiss ? () => onDismiss(runId) : undefined
      }
    />
  );
}
