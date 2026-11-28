import type { EndingPosture } from "../../../modules/request-understanding";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import { dialogueContinuityStoreKey } from "./DialogueContinuityKey";

/** Persist dialogue continuity under dlg:<sessionId> for the next start. */
export async function saveDialogueContinuity(
  deps: RuntimeDependencies | undefined,
  params: {
    sessionId?: string;
    message: string;
    mode: "ask" | "plan" | "agent";
    priorRoute: string;
    priorTaskBand?: string;
    endingPosture: EndingPosture;
    gateKind?: string;
  },
): Promise<void> {
  const store = deps?.sessionStore;
  const sessionId = params.sessionId?.trim();
  if (!store || !sessionId) return;

  await store.save({
    runId: dialogueContinuityStoreKey(sessionId),
    message: params.message,
    mode: params.mode,
    gateKind: params.gateKind,
    priorRoute: params.priorRoute,
    priorTaskBand: params.priorTaskBand,
    endingPosture: params.endingPosture,
    updatedAtMs: Date.now(),
  });
}
