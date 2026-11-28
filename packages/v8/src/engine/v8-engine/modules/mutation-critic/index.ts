/**
 * Shim — owner is runtime/helpers/loop-rails/mutation-critic.
 */
export {
  runMutationCritic,
  runV8MutationCritic,
  evaluateMutationCritic,
  extractMutationTargetPaths,
  MUTATION_CRITIC_VERDICTS,
} from "../../../../runtime/helpers/loop-rails/mutation-critic";
export type {
  V8MutationCriticDecision,
  MutationCriticVerdict,
  MutationCriticInput,
  MutationCriticResult,
  CriticMode,
} from "../../../../runtime/helpers/loop-rails/mutation-critic";
