import type { EndingPosture } from "../../../modules/request-understanding";
import type { RuntimeStartInput } from "../../contracts/input/RuntimeStartInput";

export interface DialogueContinuitySlice {
  priorRoute?: string;
  priorTaskBand?: string;
  endingPosture?: EndingPosture;
}

/**
 * Fill orphaned history.priorRoute / endingPosture from session continuity
 * when the host omitted them.
 */
export function mergeHistoryContinuity(
  history: RuntimeStartInput["history"] | undefined,
  continuity: DialogueContinuitySlice | undefined,
): RuntimeStartInput["history"] | undefined {
  if (!continuity) return history;
  const merged = {
    ...(history ?? {}),
    priorRoute: history?.priorRoute ?? continuity.priorRoute,
    priorTaskBand: history?.priorTaskBand ?? continuity.priorTaskBand,
    endingPosture: history?.endingPosture ?? continuity.endingPosture,
  };
  if (
    !merged.priorRoute &&
    !merged.priorTaskBand &&
    !merged.endingPosture &&
    !merged.digest &&
    typeof merged.compactedTurns !== "number"
  ) {
    return history;
  }
  return merged;
}
