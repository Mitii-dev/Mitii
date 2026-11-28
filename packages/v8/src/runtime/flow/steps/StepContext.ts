import type { StoreManager } from "../../helpers/store";
import type { RuntimeStartInput } from "../../contracts/input/RuntimeStartInput";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";

/** Shared bag passed through early pump steps (thin — no second Store). */
export interface StepContext {
  store: StoreManager;
  input: RuntimeStartInput;
  mode?: "ask" | "plan" | "agent";
  deps?: RuntimeDependencies;
  abortSignal?: AbortSignal;
}
