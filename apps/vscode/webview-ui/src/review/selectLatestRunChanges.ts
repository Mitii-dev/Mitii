import type { RunFileChangesView } from '../protocol';

type TurnWithFileChanges = {
  fileChanges?: RunFileChangesView;
};

/** Latest Mitii run file-changes attached to a chat turn (newest first). */
export function selectLatestRunChanges(
  turns: readonly TurnWithFileChanges[],
): RunFileChangesView | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const changes = turns[i]?.fileChanges;
    if (changes?.files?.length) return changes;
  }
  return null;
}

/** Whether the standalone review block should render above the chat box. */
export function composerNeedsReviewStrip(input: {
  chatFileCount: number;
  gitFileCount: number;
  findingsCount: number;
  codeReviewEnabled: boolean;
}): boolean {
  if (input.chatFileCount > 0) return true;
  if (input.findingsCount > 0 && input.codeReviewEnabled) return true;
  return false;
}
