import type { ReviewDiffView, RunFileChangesView } from '../protocol';
import { WorkingTreeReviewBar } from './WorkingTreeReviewBar';
import type { ReviewFindingChip } from './reviewFindingTypes';
import {
  composerNeedsReviewStrip,
  selectLatestRunChanges,
} from './selectLatestRunChanges';

type TurnLike = { fileChanges?: RunFileChangesView };

type Props = {
  review: ReviewDiffView | null;
  findings: readonly ReviewFindingChip[];
  turns: readonly TurnLike[];
  running: boolean;
  expandSignal: number;
  codeReviewEnabled: boolean;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onOpenFinding: (path: string, line?: number) => void;
  onShowChanges: () => void;
  onRunCodeReview: () => void;
  onUndoFileChanges: (runId: string) => void;
  onDismissFileChanges: (runId: string) => void;
  onDismissFindings: () => void;
  onFixAllFindings: () => void;
  onFixFinding: (index: number) => void;
};

/**
 * Composer-attached review strip with dual-scope wiring.
 * Keeps App.tsx free of run-change lookup / feature-gate details.
 */
export function ComposerReviewStrip({
  review,
  findings,
  turns,
  running,
  expandSignal,
  codeReviewEnabled,
  onRefresh,
  onOpenFile,
  onOpenDiff,
  onOpenFinding,
  onShowChanges,
  onRunCodeReview,
  onUndoFileChanges,
  onDismissFileChanges,
  onDismissFindings,
  onFixAllFindings,
  onFixFinding,
}: Props) {
  const runChanges = selectLatestRunChanges(turns);

  return (
    <WorkingTreeReviewBar
      review={review}
      findings={findings}
      runChanges={runChanges}
      running={running}
      expandSignal={expandSignal}
      onRefresh={onRefresh}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
      onOpenFinding={onOpenFinding}
      onShowChanges={onShowChanges}
      onRunCodeReview={codeReviewEnabled ? onRunCodeReview : undefined}
      showCodeReview={codeReviewEnabled}
      onUndoAll={() => {
        if (runChanges) onUndoFileChanges(runChanges.runId);
      }}
      onKeepAll={() => {
        if (runChanges) onDismissFileChanges(runChanges.runId);
      }}
      onDismissFindings={onDismissFindings}
      onFixAllFindings={onFixAllFindings}
      onFixFinding={onFixFinding}
    />
  );
}

export { composerNeedsReviewStrip, selectLatestRunChanges };
