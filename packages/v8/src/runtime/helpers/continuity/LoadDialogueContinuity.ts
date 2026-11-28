import type { EndingPosture } from "../../../modules/request-understanding";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import { dialogueContinuityStoreKey } from "./DialogueContinuityKey";
import type { DialogueContinuitySlice } from "./MergeHistoryContinuity";

export async function loadDialogueContinuity(
  deps: RuntimeDependencies | undefined,
  sessionId: string | undefined,
): Promise<DialogueContinuitySlice | undefined> {
  const store = deps?.sessionStore;
  const id = sessionId?.trim();
  if (!store || !id) return undefined;

  const carry = await store.load(dialogueContinuityStoreKey(id));
  if (!carry) return undefined;

  const slice: DialogueContinuitySlice = {};
  if (typeof carry.priorRoute === "string" && carry.priorRoute.length > 0) {
    slice.priorRoute = carry.priorRoute;
  }
  if (
    typeof carry.priorTaskBand === "string" &&
    carry.priorTaskBand.length > 0
  ) {
    slice.priorTaskBand = carry.priorTaskBand;
  }
  if (carry.endingPosture) {
    slice.endingPosture = carry.endingPosture as EndingPosture;
  }
  if (!slice.priorRoute && !slice.priorTaskBand && !slice.endingPosture) {
    return undefined;
  }
  return slice;
}
