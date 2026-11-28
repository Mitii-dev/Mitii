/**
 * Shim — owner is runtime/helpers/loop-rails/mutation-critic.
 */
export {
  MUTATION_CRITIC_VERDICTS,
  evaluateMutationCritic,
} from "../../../runtime/helpers/loop-rails/mutation-critic";
export type {
  MutationCriticVerdict,
  MutationCriticInput,
  MutationCriticResult,
} from "../../../runtime/helpers/loop-rails/mutation-critic";
/** Compat alias — runtime uses CriticMode. */
export type { CriticMode as SteeringCriticMode } from "../../../runtime/helpers/loop-rails/mutation-critic";
