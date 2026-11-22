import { describe, expect, it } from 'vitest';

import {
  LOOP_POLICY_PRESENTATION,
  SETTINGS_CATALOG,
  TOKEN_BUDGET_PRESENTATION,
  V8_LOOP_POLICY_PRESENTATION,
  numberFieldPresentationMapSchema,
  projectNumberFields,
  type NumberFieldPresentationMap,
} from '../src/index.js';

const MAPS = [
  ['tokenBudget', TOKEN_BUDGET_PRESENTATION],
  ['loopPolicy', LOOP_POLICY_PRESENTATION],
  ['v8LoopPolicy', V8_LOOP_POLICY_PRESENTATION],
] as const satisfies readonly (readonly [string, NumberFieldPresentationMap])[];

function catalogNumberKeys(prefix: string): string[] {
  const head = `mitii.${prefix}.`;
  return Object.entries(SETTINGS_CATALOG)
    .filter(
      ([key, entry]) =>
        key.startsWith(head) &&
        key !== `${head}enabled` &&
        ['number', 'integer'].includes(entry.type as string),
    )
    .map(([key]) => key.slice(head.length));
}

describe.each(MAPS)('%s presentation', (prefix, map) => {
  it('is a valid presentation map', () => {
    expect(numberFieldPresentationMapSchema.safeParse(map).success).toBe(true);
  });

  it('names exactly the catalog number keys', () => {
    expect(Object.keys(map).sort()).toEqual(catalogNumberKeys(prefix).sort());
  });

  it('gives every field a group and a label distinct from its key', () => {
    for (const [key, presentation] of Object.entries(map)) {
      expect(presentation.group, key).toBeTruthy();
      expect(presentation.label, key).toBeTruthy();
      expect(presentation.label, key).not.toBe(key);
    }
  });

  it('projects into descriptors with the presentation order and facts', () => {
    const fields = projectNumberFields(prefix, map, { tier: () => 'advanced' });
    expect(fields.map((f) => f.key)).toEqual(Object.keys(map));
    for (const field of fields) {
      expect(field.group, field.key).toBe(map[field.key]!.group);
      expect(field.label, field.key).toBe(map[field.key]!.label);
    }
  });
});

describe('tier and visibility facts', () => {
  const tierOf = (map: NumberFieldPresentationMap, tier: string) =>
    Object.entries(map)
      .filter(([, p]) => p.tier === tier)
      .map(([key]) => key)
      .sort();

  it('tokenBudget has the five Simple shares and hides run-cap fields from Debug', () => {
    expect(tierOf(TOKEN_BUDGET_PRESENTATION, 'simple')).toEqual([
      'conversationShare',
      'outputRatio',
      'planShare',
      'repositoryShare',
      'skillsShare',
    ]);
    expect(
      Object.entries(TOKEN_BUDGET_PRESENTATION)
        .filter(([, p]) => p.hiddenFromDebug)
        .map(([key]) => key)
        .sort(),
    ).toEqual(['maxModelCallsMax', 'maxModelCallsMin', 'maxModelCallsPerUsable']);
  });

  it('loopPolicy has six Simple keys and the rest Advanced', () => {
    expect(tierOf(LOOP_POLICY_PRESENTATION, 'simple')).toHaveLength(6);
    expect(tierOf(LOOP_POLICY_PRESENTATION, 'advanced').length).toBeGreaterThan(0);
    expect(
      Object.values(LOOP_POLICY_PRESENTATION).every((p) => p.tier !== undefined),
    ).toBe(true);
  });

  it('v8LoopPolicy has four Simple and four Advanced keys', () => {
    expect(tierOf(V8_LOOP_POLICY_PRESENTATION, 'simple')).toHaveLength(4);
    expect(tierOf(V8_LOOP_POLICY_PRESENTATION, 'advanced')).toHaveLength(4);
  });
});
