import type { WindowBudgetPolicyOverrides } from "./contracts";

/**
 * Per-model window-budget profiles.
 *
 * A profile is a static policy overlay keyed by model id. It slots between
 * the window band and the interaction-mode overlay:
 *
 *   defaults → band → model profile → mode → host lab overrides
 *
 * Profiles tune window-owned knobs only (output caps, tool-loop output
 * ceiling, repair/call counts). They never carry provider secrets or
 * endpoints, and they never change the advertised context window — that
 * remains the Model Gateway's / host's responsibility.
 *
 * The shipped table is intentionally empty: add an entry only with evidence
 * from a benchmark or live run, and keep the `id` stable for traceability.
 */
export interface WindowBudgetModelProfile {
  /** Stable identifier, e.g. `"reasoning-heavy"`. */
  id: string;
  /** Matched case-insensitively against the model id. */
  match: RegExp;
  /** Partial window-budget policy applied when the profile matches. */
  overrides: WindowBudgetPolicyOverrides;
}

export const WINDOW_BUDGET_MODEL_PROFILES: readonly WindowBudgetModelProfile[] =
  [];

/** First matching profile wins; order the table most-specific first. */
export function resolveWindowBudgetModelProfile(
  modelId: string | undefined,
  profiles: readonly WindowBudgetModelProfile[] = WINDOW_BUDGET_MODEL_PROFILES,
): WindowBudgetModelProfile | undefined {
  const id = modelId?.trim();
  if (!id) {
    return undefined;
  }
  return profiles.find((profile) => profile.match.test(id));
}
