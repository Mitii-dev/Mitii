export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface PolicyEvaluationContext {
  action: string;
  mode?: string;
  edition: 'ce' | 'ee';
  metadata?: Record<string, unknown>;
}

export interface PolicyContribution {
  id: string;
  owner: string;
  priority: number;
  evaluate(context: PolicyEvaluationContext): PolicyDecision | Promise<PolicyDecision>;
}
