/**
 * Expandable post-run changes panel for the composer dock.
 */

import type { DesktopFileChangeEntry } from '../shared/fileChanges.js';
import {
  WorkingTreeReviewBar,
  type ReviewFindingChip,
  type RunFileChangesSummary,
} from './git/WorkingTreeReviewBar.js';

export type { ReviewFindingChip, RunFileChangesSummary };

export interface ComposerReviewStripProps {
  findings: readonly ReviewFindingChip[];
  /** Count of files touched by the latest Mitii run. */
  fileChangeCount: number;
  files?: readonly DesktopFileChangeEntry[];
  runId?: string;
  totalAdditions?: number;
  totalDeletions?: number;
  running?: boolean;
  onShowChanges: () => void;
  onOpenFile?: (path: string) => void;
  onUndoChanges?: (runId: string) => void;
  onFixAll?: () => void;
  onDismiss?: (runId?: string) => void;
}

export function ComposerReviewStrip({
  findings,
  fileChangeCount,
  files = [],
  runId,
  totalAdditions = 0,
  totalDeletions = 0,
  running = false,
  onShowChanges,
  onOpenFile,
  onUndoChanges,
  onFixAll,
  onDismiss,
}: ComposerReviewStripProps) {
  const runChanges: RunFileChangesSummary | null =
    runId && fileChangeCount > 0
      ? {
          runId,
          fileCount: fileChangeCount,
          totalAdditions,
          totalDeletions,
        }
      : null;

  return (
    <WorkingTreeReviewBar
      fileChangeCount={fileChangeCount}
      findings={findings}
      files={files}
      running={running}
      runChanges={runChanges}
      totalAdditions={totalAdditions}
      totalDeletions={totalDeletions}
      onShowChanges={onShowChanges}
      onOpenFile={onOpenFile}
      onUndoChanges={
        runId && onUndoChanges ? () => onUndoChanges(runId) : undefined
      }
      onFixAll={onFixAll}
      onDismiss={onDismiss ? () => onDismiss(runId) : undefined}
    />
  );
}
