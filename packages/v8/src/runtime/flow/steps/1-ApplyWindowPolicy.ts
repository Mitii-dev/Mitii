import type { StepContext } from "./StepContext";

/** Step 1 — record window policy band (numbers owned by window-budget module). */
export function applyWindowPolicy(ctx: StepContext): void {
  const contextWindowTokens =
    typeof ctx.input.contextWindowTokens === "number"
      ? ctx.input.contextWindowTokens
      : 80_000;
  ctx.store.setSlice("windowPolicy", {
    applied: true,
    source: "runtime_defaults",
    contextWindowTokens,
  });
}
