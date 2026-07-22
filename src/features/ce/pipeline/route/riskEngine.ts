import type { OperationClass, RiskLevel } from '../types';
import { DESTRUCTIVE_OPERATION_RE, REMOTE_OR_PRODUCTION_RE } from './constants';

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

/** Base risk contributed by the operation's effect — read-only is free, remote/release cost the most. */
export const OPERATION_EFFECT_SCORE: Record<OperationClass, number> = {
  inspect: 0,
  log_analyze: 0,
  execute_saved_plan: 1,
  workspace_write: 2,
  local_git_write: 2,
  remote_write: 4,
  release: 5,
};

/** Score → level. Kept as three buckets; `critical` remains reserved for Git's own risk model. */
function levelForScore(score: number): RiskLevel {
  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

/**
 * Factor-based risk assessment: effect (operation class) + destructive/remote keywords +
 * complexity, instead of an intent-keyed if-chain. Replaces the old "unknown mutation
 * defaults to low" behavior — an unrecognized workspace write now defaults to medium.
 */
export function resolveRiskFactors(
  operationClass: OperationClass,
  text: string,
  complexity?: 'low' | 'medium' | 'high'
): RiskAssessment {
  const reasons: string[] = [];
  let score = OPERATION_EFFECT_SCORE[operationClass];
  reasons.push(`operation class '${operationClass}' (base score ${score})`);

  if (DESTRUCTIVE_OPERATION_RE.test(text)) {
    score += 3;
    reasons.push('destructive keyword detected (delete/drop/purge/force push/reset --hard)');
  }
  if (REMOTE_OR_PRODUCTION_RE.test(text)) {
    score += 2;
    reasons.push('remote/production keyword detected');
  }
  if (complexity === 'high') {
    score += 1;
    reasons.push('high task complexity');
  }

  return { level: levelForScore(score), reasons };
}
