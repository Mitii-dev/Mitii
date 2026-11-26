import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import type { RuntimeSessionCarry } from "./RuntimeSessionCarry";

/** Persist session carry when a session store is composed. */
export async function saveRuntimeSessionCarry(
  deps: RuntimeDependencies | undefined,
  carry: Omit<RuntimeSessionCarry, "updatedAtMs">,
): Promise<void> {
  const store = deps?.sessionStore;
  if (!store) return;
  await store.save({
    ...carry,
    updatedAtMs: Date.now(),
  });
}
