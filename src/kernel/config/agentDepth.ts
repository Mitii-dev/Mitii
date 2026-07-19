/**
 * Canonical agent depth options shown in composer + settings.
 * Legacy values (standard/pilot/enterprise) are normalized for compatibility.
 */
export const AGENT_DEPTHS = ['auto', 'quick', 'deep'] as const;
export type AgentDepth = (typeof AGENT_DEPTHS)[number];

/** Values historically accepted in settings / APIs before the 3-depth UI. */
export const LEGACY_AGENT_DEPTHS = ['standard', 'pilot', 'enterprise'] as const;
export type LegacyAgentDepth = (typeof LEGACY_AGENT_DEPTHS)[number];
export type AgentDepthInput = AgentDepth | LegacyAgentDepth | string | null | undefined;

export interface AgentDepthOption {
  id: AgentDepth;
  label: string;
  description: string;
  askLabel: string;
  planLabel: string;
  actLabel: string;
  color: string;
}

export const AGENT_DEPTH_OPTIONS: readonly AgentDepthOption[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Choose depth from the request',
    askLabel: 'Auto',
    planLabel: 'Auto discovery',
    actLabel: 'Auto execution',
    color: '#38bdf8',
  },
  {
    id: 'quick',
    label: 'Quick',
    description: 'Smaller exploration or execution budget',
    askLabel: 'Quick',
    planLabel: 'Quick discovery',
    actLabel: 'Quick execution',
    color: '#22c55e',
  },
  {
    id: 'deep',
    label: 'Deep',
    description: 'Larger budget for complex work',
    askLabel: 'Deep',
    planLabel: 'Deep discovery',
    actLabel: 'Deep execution',
    color: '#f59e0b',
  },
] as const;

const AGENT_DEPTH_SET = new Set<string>(AGENT_DEPTHS);

/**
 * Map any stored/API depth onto the canonical 3-option set.
 * standard/pilot/enterprise → deep so prior “more budget” choices keep strength.
 */
export function normalizeAgentDepth(value: AgentDepthInput, fallback: AgentDepth = 'auto'): AgentDepth {
  if (typeof value !== 'string') return fallback;
  const depth = value.trim().toLowerCase();
  if (AGENT_DEPTH_SET.has(depth)) return depth as AgentDepth;
  if (depth === 'standard' || depth === 'pilot' || depth === 'enterprise') return 'deep';
  return fallback;
}

export function isAgentDepth(value: unknown): value is AgentDepth {
  return typeof value === 'string' && AGENT_DEPTH_SET.has(value);
}

export function agentDepthOption(depth: AgentDepthInput): AgentDepthOption {
  const normalized = normalizeAgentDepth(depth);
  return AGENT_DEPTH_OPTIONS.find((option) => option.id === normalized) ?? AGENT_DEPTH_OPTIONS[0];
}
