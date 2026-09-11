/**
 * Host/engine feature flags for Understanding Ballot + Decision Steering.
 * Defaults are off (fail closed / no behavior change until explicitly enabled).
 */
export const STEERING_CRITIC_MODES = ["off", "shadow", "enforce"] as const;
export type SteeringCriticMode = (typeof STEERING_CRITIC_MODES)[number];

export interface SteeringFeatureFlags {
  /** Situation slots, closed skill-tag intersect, structured option resume. */
  understandingBallotV2: boolean;
  /** Prefer high-confidence understanding over looksLike* (except safety). */
  policyFactsFirst: boolean;
  /** Inject deterministic DecisionBrief into the system prompt. */
  decisionBrief: boolean;
  /** Pre-mutation critic: off | shadow (log only) | enforce (narrow/pause). */
  criticMode: SteeringCriticMode;
}

export const DEFAULT_STEERING_FEATURE_FLAGS: SteeringFeatureFlags = {
  understandingBallotV2: false,
  policyFactsFirst: false,
  decisionBrief: false,
  criticMode: "off",
};

export function resolveSteeringFeatureFlags(
  overrides?: Partial<SteeringFeatureFlags> | null,
): SteeringFeatureFlags {
  if (!overrides) {
    return { ...DEFAULT_STEERING_FEATURE_FLAGS };
  }
  const criticMode = overrides.criticMode ?? DEFAULT_STEERING_FEATURE_FLAGS.criticMode;
  return {
    understandingBallotV2:
      overrides.understandingBallotV2 ??
      DEFAULT_STEERING_FEATURE_FLAGS.understandingBallotV2,
    policyFactsFirst:
      overrides.policyFactsFirst ??
      DEFAULT_STEERING_FEATURE_FLAGS.policyFactsFirst,
    decisionBrief:
      overrides.decisionBrief ?? DEFAULT_STEERING_FEATURE_FLAGS.decisionBrief,
    criticMode: STEERING_CRITIC_MODES.includes(criticMode)
      ? criticMode
      : "off",
  };
}
