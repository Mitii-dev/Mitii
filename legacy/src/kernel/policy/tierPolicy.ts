export type AgenticTier = 'local-small' | 'local-large' | 'cloud-standard' | 'cloud-frontier';
export type ReasoningEffort = 'low' | 'medium' | 'high';
export type SkillInjectionStyle = 'none' | 'catalog' | 'quick-ref' | 'full';
export type ToolExposure = 'minimal' | 'standard' | 'full';

export interface TierPolicy {
  skillInjection: SkillInjectionStyle;
  maxSkillChars: number;
  rulesMaxTotalChars: number;
  rulesMaxCharsPerFile: number;
  maxContextItems?: number;
  maxStepScale?: number;
  reasoningEffort?: ReasoningEffort;
  toolExposure?: ToolExposure;
}

export function scaleTierSteps(base: number, policy: Pick<TierPolicy, 'maxStepScale'> | undefined, cap: number): number {
  const normalized = Math.max(1, Math.floor(base || 1));
  const scale = policy?.maxStepScale ?? 1;
  return Math.max(1, Math.min(Math.ceil(normalized * scale), cap));
}

export function describeTier(tier: AgenticTier, policy: TierPolicy): string {
  return `${tier} · skills=${policy.skillInjection} · tools=${policy.toolExposure ?? 'standard'}`;
}
