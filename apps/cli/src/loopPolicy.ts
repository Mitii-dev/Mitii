import {
  agentEngineThresholdsOverridesSchema,
  type AgentEngineThresholdsOverrides,
} from '@mitii/sdk';

/**
 * Lab loop-policy block for `.mitii/config.json`.
 * When `enabled` is false/omitted, Engine uses window-band standards only.
 */
export interface MitiiLoopPolicyConfig {
  enabled?: boolean;
  thresholds?: AgentEngineThresholdsOverrides;
}

export function parseLoopPolicyConfig(
  raw: unknown,
): MitiiLoopPolicyConfig | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const enabled =
    typeof obj.enabled === 'boolean' ? obj.enabled : undefined;
  let thresholds: AgentEngineThresholdsOverrides | undefined;
  if (obj.thresholds !== undefined) {
    try {
      thresholds = agentEngineThresholdsOverridesSchema.parse(obj.thresholds);
    } catch {
      thresholds = undefined;
    }
  }
  if (enabled === undefined && thresholds === undefined) {
    return undefined;
  }
  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(thresholds ? { thresholds } : {}),
  };
}

export function serializeLoopPolicyConfig(
  policy: MitiiLoopPolicyConfig | undefined,
): Record<string, unknown> | undefined {
  if (!policy) return undefined;
  const payload: Record<string, unknown> = {};
  if (policy.enabled !== undefined) payload.enabled = policy.enabled;
  if (policy.thresholds && Object.keys(policy.thresholds).length > 0) {
    payload.thresholds = { ...policy.thresholds };
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}

/**
 * Resolve lab overrides for `MitiiStartInput.loopPolicy`.
 * Returns undefined when Custom is off so Engine uses window bands alone.
 */
export function resolveCliLoopPolicyThresholds(options: {
  config?: MitiiLoopPolicyConfig;
  /** One-off JSON from `--loop-policy-json` (implies enabled unless disabled). */
  flagJson?: string;
  /** `--no-loop-policy` forces off. */
  disabled?: boolean;
}): AgentEngineThresholdsOverrides | undefined {
  if (options.disabled) {
    return undefined;
  }

  let flagThresholds: AgentEngineThresholdsOverrides | undefined;
  if (options.flagJson !== undefined) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(options.flagJson);
    } catch {
      throw new Error(
        'mitii: --loop-policy-json must be valid JSON object of threshold overrides',
      );
    }
    try {
      flagThresholds = agentEngineThresholdsOverridesSchema.parse(parsedJson);
    } catch {
      throw new Error(
        'mitii: --loop-policy-json keys must be known loop-policy thresholds with valid numbers',
      );
    }
  }

  const configEnabled = options.config?.enabled === true;
  const configThresholds = options.config?.thresholds;

  if (!flagThresholds && !configEnabled) {
    return undefined;
  }

  const merged: AgentEngineThresholdsOverrides = {
    ...(configEnabled && configThresholds ? configThresholds : {}),
    ...(flagThresholds ?? {}),
  };

  if (Object.keys(merged).length === 0) {
    // Enabled with empty thresholds still means "use band only" — no start field.
    return undefined;
  }
  return agentEngineThresholdsOverridesSchema.parse(merged);
}

export function formatLoopPolicySummary(
  policy: MitiiLoopPolicyConfig | undefined,
): string {
  if (!policy || policy.enabled !== true) {
    return '  loopPolicy off (window-band standards)';
  }
  const keys = policy.thresholds
    ? Object.keys(policy.thresholds).sort()
    : [];
  if (keys.length === 0) {
    return '  loopPolicy enabled (no threshold overrides yet)';
  }
  const preview = keys
    .slice(0, 6)
    .map((key) => `${key}=${String(policy.thresholds?.[key as keyof AgentEngineThresholdsOverrides])}`)
    .join(', ');
  const more = keys.length > 6 ? `, +${keys.length - 6} more` : '';
  return `  loopPolicy enabled (${preview}${more})`;
}
