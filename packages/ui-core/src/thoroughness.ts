/**
 * Clubbed customer control for exploration depth + working-set effort.
 *
 * Engine still receives two orthogonal fields (`explorationDepth`, `effort`).
 * Hosts SHOULD expose one Thoroughness knob (Low / Medium / High) and only
 * unlock separate depth/effort under Developer → intensity overrides.
 */

export type AgentUiDepth = 'auto' | 'quick' | 'deep';
export type AgentUiEffort = 'low' | 'medium' | 'high';
export type AgentUiThoroughness = 'low' | 'medium' | 'high';

export const AGENT_UI_THOROUGHNESS = ['low', 'medium', 'high'] as const;

export const THOROUGHNESS_PRESETS: Record<
  AgentUiThoroughness,
  { depth: AgentUiDepth; effort: AgentUiEffort }
> = {
  low: { depth: 'quick', effort: 'low' },
  medium: { depth: 'auto', effort: 'medium' },
  high: { depth: 'deep', effort: 'high' },
};

/** Default thoroughness when a mode has no stored value. */
export const DEFAULT_THOROUGHNESS_BY_MODE: Record<
  'ask' | 'plan' | 'agent',
  AgentUiThoroughness
> = {
  ask: 'medium',
  plan: 'high',
  agent: 'medium',
};

export function isAgentUiThoroughness(
  value: unknown,
): value is AgentUiThoroughness {
  return value === 'low' || value === 'medium' || value === 'high';
}

export function isAgentUiDepth(value: unknown): value is AgentUiDepth {
  return value === 'auto' || value === 'quick' || value === 'deep';
}

export function isAgentUiEffort(value: unknown): value is AgentUiEffort {
  return value === 'low' || value === 'medium' || value === 'high';
}

export function resolveThoroughnessPreset(
  thoroughness: AgentUiThoroughness,
): { depth: AgentUiDepth; effort: AgentUiEffort } {
  return { ...THOROUGHNESS_PRESETS[thoroughness] };
}

/**
 * When depth+effort match a clubbed preset, return it; otherwise undefined
 * (custom / developer override).
 */
export function inferThoroughness(
  depth: AgentUiDepth,
  effort: AgentUiEffort,
): AgentUiThoroughness | undefined {
  for (const key of AGENT_UI_THOROUGHNESS) {
    const preset = THOROUGHNESS_PRESETS[key];
    if (preset.depth === depth && preset.effort === effort) {
      return key;
    }
  }
  return undefined;
}

/** Migrate legacy depth-only settings to the nearest clubbed thoroughness. */
export function thoroughnessFromDepth(depth: AgentUiDepth): AgentUiThoroughness {
  if (depth === 'quick') return 'low';
  if (depth === 'deep') return 'high';
  return 'medium';
}

export function resolveRunIntensity(params: {
  intensityOverrides: boolean;
  thoroughness?: AgentUiThoroughness;
  depth?: AgentUiDepth;
  effort?: AgentUiEffort;
}): {
  depth: AgentUiDepth;
  effort: AgentUiEffort;
  thoroughness: AgentUiThoroughness;
  custom: boolean;
} {
  if (params.intensityOverrides) {
    const depth = isAgentUiDepth(params.depth) ? params.depth : 'auto';
    const effort = isAgentUiEffort(params.effort) ? params.effort : 'medium';
    const matched = inferThoroughness(depth, effort);
    return {
      depth,
      effort,
      thoroughness: matched ?? 'medium',
      custom: matched === undefined,
    };
  }

  const thoroughness = isAgentUiThoroughness(params.thoroughness)
    ? params.thoroughness
    : isAgentUiDepth(params.depth)
      ? thoroughnessFromDepth(params.depth)
      : 'medium';
  const preset = resolveThoroughnessPreset(thoroughness);
  return {
    ...preset,
    thoroughness,
    custom: false,
  };
}

/**
 * Normalize mode defaults after load: fill thoroughness, detect custom pairs.
 */
export function normalizeIntensitySettings(params: {
  modeDefaults: Record<
    'ask' | 'plan' | 'agent',
    {
      depth?: AgentUiDepth;
      thoroughness?: AgentUiThoroughness;
      approvalMode: string;
      model?: string;
    }
  >;
  effort: AgentUiEffort;
  intensityOverrides?: boolean;
}): {
  modeDefaults: Record<
    'ask' | 'plan' | 'agent',
    {
      thoroughness: AgentUiThoroughness;
      depth: AgentUiDepth;
      approvalMode: string;
      model?: string;
    }
  >;
  effort: AgentUiEffort;
  intensityOverrides: boolean;
} {
  let intensityOverrides = params.intensityOverrides === true;
  const modes = ['ask', 'plan', 'agent'] as const;
  const modeDefaults = {} as Record<
    'ask' | 'plan' | 'agent',
    {
      thoroughness: AgentUiThoroughness;
      depth: AgentUiDepth;
      approvalMode: string;
      model?: string;
    }
  >;

  for (const mode of modes) {
    const current = params.modeDefaults[mode];
    const depth = isAgentUiDepth(current.depth)
      ? current.depth
      : THOROUGHNESS_PRESETS[DEFAULT_THOROUGHNESS_BY_MODE[mode]].depth;
    let thoroughness = isAgentUiThoroughness(current.thoroughness)
      ? current.thoroughness
      : undefined;

    if (!thoroughness) {
      thoroughness = thoroughnessFromDepth(depth);
    }

    if (!intensityOverrides) {
      const preset = resolveThoroughnessPreset(thoroughness);
      modeDefaults[mode] = {
        thoroughness,
        depth: preset.depth,
        approvalMode: current.approvalMode,
        ...(current.model !== undefined ? { model: current.model } : {}),
      };
    } else {
      modeDefaults[mode] = {
        thoroughness,
        depth,
        approvalMode: current.approvalMode,
        ...(current.model !== undefined ? { model: current.model } : {}),
      };
    }
  }

  // Global effort is a cache for Developer overrides / last composer pick.
  // When overrides are off, run-time effort comes from the active mode's
  // thoroughness via resolveRunIntensity.
  return {
    modeDefaults,
    effort: isAgentUiEffort(params.effort) ? params.effort : 'medium',
    intensityOverrides,
  };
}

/** Patch produced when the customer picks a thoroughness level. */
export function thoroughnessUiPatch(params: {
  mode: 'ask' | 'plan' | 'agent';
  thoroughness: AgentUiThoroughness;
}): {
  intensityOverrides: false;
  effort: AgentUiEffort;
  modeDefaults: Partial<
    Record<
      'ask' | 'plan' | 'agent',
      { thoroughness: AgentUiThoroughness; depth: AgentUiDepth }
    >
  >;
} {
  const preset = resolveThoroughnessPreset(params.thoroughness);
  return {
    intensityOverrides: false,
    effort: preset.effort,
    modeDefaults: {
      [params.mode]: {
        thoroughness: params.thoroughness,
        depth: preset.depth,
      },
    },
  };
}
