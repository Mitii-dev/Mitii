import type { RuntimeModelMessage } from "../../ports/RuntimeModelPort";

/**
 * After mutation-approve settle, replace packed messages with the saved
 * turn-loop transcript so the model continues instead of rediscovering.
 */
export function applyTurnLoopMutationResume(input: {
  getSlice: <T>(key: string) => T | undefined;
  setSlice: (key: string, value: unknown) => void;
  packedMessages: RuntimeModelMessage[];
}): { messages: RuntimeModelMessage[]; resumed: boolean } {
  const resumeMsgs = input.getSlice<RuntimeModelMessage[]>("turnLoopMessages");
  if (
    input.getSlice<boolean>("mutationSettledOnResume") === true &&
    resumeMsgs &&
    resumeMsgs.length > 0
  ) {
    input.setSlice("mutationSettledOnResume", false);
    return { messages: [...resumeMsgs], resumed: true };
  }
  return { messages: input.packedMessages, resumed: false };
}
