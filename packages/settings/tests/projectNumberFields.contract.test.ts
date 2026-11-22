import { describe, expect, it } from 'vitest';

import {
  PROJECT_NUMBER_FIELDS_REASONS,
  ProjectNumberFieldsError,
  SETTINGS_CATALOG,
  numberFieldDescriptorSchema,
  parseSettingsCatalog,
  projectNumberFields,
} from '../src/index.js';

const catalog = parseSettingsCatalog({
  'mitii.demo.enabled': { type: 'boolean', description: 'on', default: false },
  'mitii.demo.ratio': {
    type: 'number',
    description: 'a ratio',
    default: 0.5,
    minimum: 0,
    maximum: 1,
  },
  'mitii.demo.count': {
    type: 'number',
    description: 'a count',
    default: 10,
    minimum: 1,
  },
  'mitii.demo.whole': { type: 'integer', description: 'whole', default: 3 },
  'mitii.demo.mode': { type: 'string', description: 'mode', default: 'a' },
  'mitii.demo.nullable': {
    type: ['number', 'null'],
    description: 'nullable',
    default: null,
    minimum: 2,
  },
});

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ProjectNumberFieldsError ? error.reason : 'other';
  }
  return undefined;
}

describe('projectNumberFields', () => {
  it('projects only numeric entries, skipping enabled and non-numbers', () => {
    const fields = projectNumberFields('demo', {}, { catalog });
    expect(fields.map((f) => f.key)).toEqual(['ratio', 'count', 'whole', 'nullable']);
    for (const field of fields) {
      expect(numberFieldDescriptorSchema.safeParse(field).success).toBe(true);
    }
  });

  it('takes bounds, description, and default from the catalog', () => {
    const [ratio, count, whole, nullable] = projectNumberFields('demo', {}, { catalog });
    expect(ratio).toMatchObject({
      key: 'ratio',
      label: 'ratio',
      group: 'demo',
      description: 'a ratio',
      kind: 'ratio',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
      tier: 'simple',
    });
    expect(count).toMatchObject({ kind: 'number', min: 1, step: 1, defaultValue: 10 });
    expect(count).not.toHaveProperty('max');
    expect(whole).toMatchObject({ kind: 'int', min: 0, step: 1 });
    expect(nullable).toMatchObject({ min: 2 });
    expect(nullable?.defaultValue).toBeUndefined();
  });

  it('applies presentation overlay and orders by overlay keys first', () => {
    const fields = projectNumberFields(
      'demo',
      {
        count: { group: 'Counts', label: 'Count', kind: 'int', step: 5, tier: 'advanced', hiddenFromDebug: true, docsHref: 'https://x.test/c' },
      },
      { catalog },
    );
    expect(fields.map((f) => f.key)).toEqual(['count', 'ratio', 'whole', 'nullable']);
    expect(fields[0]).toMatchObject({
      group: 'Counts',
      label: 'Count',
      kind: 'int',
      step: 5,
      tier: 'advanced',
      hiddenFromDebug: true,
      docsHref: 'https://x.test/c',
      description: 'a count',
      min: 1,
    });
  });

  it('prefers options.defaults over the catalog default', () => {
    const fields = projectNumberFields(
      'demo',
      {},
      { catalog, defaults: { ratio: 0.9, count: undefined } },
    );
    expect(fields.find((f) => f.key === 'ratio')?.defaultValue).toBe(0.9);
    expect(fields.find((f) => f.key === 'count')?.defaultValue).toBe(10);
  });

  it('uses group and tier options as fallbacks only', () => {
    const fields = projectNumberFields(
      'demo',
      { ratio: { group: 'Own', tier: 'simple' } },
      { catalog, group: 'Fallback', tier: () => 'advanced' },
    );
    expect(fields.find((f) => f.key === 'ratio')).toMatchObject({ group: 'Own', tier: 'simple' });
    expect(fields.find((f) => f.key === 'count')).toMatchObject({ group: 'Fallback', tier: 'advanced' });
  });

  it('fails with stable reason codes', () => {
    expect(reasonOf(() => projectNumberFields('demo', { nope: {} }, { catalog }))).toBe('unknown_overlay_key');
    expect(reasonOf(() => projectNumberFields('demo', { mode: {} }, { catalog }))).toBe('unknown_overlay_key');
    expect(reasonOf(() => projectNumberFields('demo', {}, { catalog, defaults: { nope: 1 } }))).toBe('unknown_default_key');
    expect(reasonOf(() => projectNumberFields('demo', { ratio: { step: -1 } }, { catalog }))).toBe('invalid_overlay');
    expect(
      reasonOf(() =>
        projectNumberFields('demo', { ratio: { bogus: 1 } } as never, { catalog }),
      ),
    ).toBe('invalid_overlay');
    expect([...PROJECT_NUMBER_FIELDS_REASONS]).toContain('invalid_descriptor');
  });

  it('rejects descriptors whose max is below min', () => {
    const bad = parseSettingsCatalog({
      'mitii.bad.x': { type: 'number', description: 'x', minimum: 0, maximum: 1 },
    });
    expect(projectNumberFields('bad', {}, { catalog: bad })).toHaveLength(1);
    expect(
      numberFieldDescriptorSchema.safeParse({
        key: 'x', group: 'g', label: 'x', description: '', kind: 'number', min: 5, max: 1, step: 1,
      }).success,
    ).toBe(false);
  });

  it('projects the real tokenBudget and loopPolicy catalogs', () => {
    for (const prefix of ['tokenBudget', 'loopPolicy', 'v8LoopPolicy']) {
      const fields = projectNumberFields(prefix);
      expect(fields.length).toBeGreaterThan(0);
      for (const field of fields) {
        const entry = SETTINGS_CATALOG[`mitii.${prefix}.${field.key}`];
        expect(entry, field.key).toBeTruthy();
        expect(field.description).toBe(entry?.description);
        expect(field.min).toBe(entry?.minimum ?? 0);
        expect(field.max).toBe(entry?.maximum);
        expect(field.defaultValue).toBe(entry?.default);
      }
    }
    expect(projectNumberFields('tokenBudget')).toHaveLength(108);
  });
});
