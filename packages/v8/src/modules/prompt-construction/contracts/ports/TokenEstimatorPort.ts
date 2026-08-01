/**
 * Estimates token usage for prompt budgeting.
 * When Model Gateway's LlmPort.countTokens is unavailable, Engine injects
 * an estimator here — Prompt Construction never guesses provider tokenization.
 */
export interface TokenEstimatorPort {
  estimate(content: string): number;
}
