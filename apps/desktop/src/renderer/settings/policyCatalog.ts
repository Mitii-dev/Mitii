/** Numeric policy descriptors for token-budget / loop-policy editors. */

import type { TokenBudgetFieldDescriptor } from '@mitii/ui-react';
import { DEFAULT_WINDOW_BUDGET_NUMBERS } from '@mitii/ui-core';
import {
  SETTINGS_CATALOG,
  projectNumberFields,
  type NumberFieldPresentationMap,
} from '@mitii/settings';

export function numericPolicyRecord(
  block: Record<string, unknown>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(block)) {
    if (key === 'enabled') continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

export type PolicyPrefix = 'tokenBudget' | 'loopPolicy' | 'v8LoopPolicy';

interface PolicyPresentation {
  group: string;
  /** Keys shown as Simple controls; every other key is Advanced. */
  simple: ReadonlySet<string>;
  overlay: NumberFieldPresentationMap;
}

/**
 * Desktop's thin presentation per prefix: group, Simple keys, Debug-hidden
 * keys. The Simple sets mirror the VS Code presentation overlays so the two
 * hosts expose the same Simple/Advanced split.
 */
const PRESENTATION: Record<PolicyPrefix, PolicyPresentation> = {
  tokenBudget: {
    group: 'Token budget',
    simple: new Set([
      'outputRatio',
      'repositoryShare',
      'conversationShare',
      'planShare',
      'skillsShare',
    ]),
    overlay: {
      maxModelCallsPerUsable: { hiddenFromDebug: true },
      maxModelCallsMin: { hiddenFromDebug: true },
      maxModelCallsMax: { hiddenFromDebug: true },
    },
  },
  loopPolicy: {
    group: 'Loop thresholds',
    simple: new Set([
      'explorationRereadMinCalls',
      'explorationRereadRatio',
      'maxExplorationStallNudges',
      'maxReadOnlyToolTurnsBeforeMutationNudge',
      'maxReadOnlyMutationRetryAttempts',
      'maxReadOnlyToolTurnsAfterMutationNudge',
    ]),
    overlay: {},
  },
  v8LoopPolicy: {
    group: 'V8 engine',
    simple: new Set([
      'maxReadOnlyTurnsBeforeMutationNudge',
      'toolLoopSoftIdentical',
      'toolLoopHardIdentical',
      'maxTruncationRecoveries',
    ]),
    overlay: {},
  },
};

/** Ship baselines the renderer can see; other prefixes use catalog defaults. */
function baselineDefaults(prefix: PolicyPrefix): Record<string, number> {
  if (prefix !== 'tokenBudget') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(DEFAULT_WINDOW_BUDGET_NUMBERS)) {
    if (SETTINGS_CATALOG[`mitii.${prefix}.${key}`] !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** Catalog projection with Desktop's group/tier presentation for a prefix. */
export function catalogNumberDescriptors(
  prefix: PolicyPrefix,
): TokenBudgetFieldDescriptor[] {
  const { group, simple, overlay } = PRESENTATION[prefix];
  return projectNumberFields(prefix, overlay, {
    group,
    tier: (shortKey) => (simple.has(shortKey) ? 'simple' : 'advanced'),
    defaults: baselineDefaults(prefix),
  });
}
