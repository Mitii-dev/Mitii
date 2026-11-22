import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DESKTOP_SETTINGS,
  DEFAULT_MITII_SETTINGS,
  DESKTOP_DEFAULT_OVERRIDES,
  SETTINGS_CATALOG,
  catalogEntriesForPrefix,
  catalogToContributesProperties,
  diffContributesProperties,
  flattenNestedSettings,
  getNestedSetting,
  nestFlatSettings,
  parseSettingsCatalog,
  setNestedSetting,
  type DesktopSettings,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../scripts/check-vscode-contributes.mjs');
const vscodeManifest = resolve(here, '../../../apps/vscode/package.json');

const V8_LOOP_KEYS: Record<string, unknown> = {
  enabled: false,
  maxContinueOverrides: 4,
  maxReadOnlyTurnsBeforeMutationNudge: 12,
  maxReasoningCharsWithoutProgress: 28000,
  maxTruncationRecoveries: 3,
  maxUnfulfilledExecuteRecoveries: 2,
  preferredBatchSize: 12,
  toolLoopHardIdentical: 6,
  toolLoopSoftIdentical: 3,
};

describe('settings catalog contract', () => {
  it('holds 212 valid mitii.* entries', () => {
    expect(Object.keys(SETTINGS_CATALOG)).toHaveLength(212);
    expect(() => parseSettingsCatalog(SETTINGS_CATALOG)).not.toThrow();
  });

  it('includes the previously drifted VS Code keys', () => {
    expect(SETTINGS_CATALOG['mitii.loopPolicy.maxReasoningCharsWithoutProgress']).toMatchObject({
      default: 28000,
      type: 'number',
    });
    expect(SETTINGS_CATALOG['mitii.workspace.indexConcurrency']).toMatchObject({
      default: 0,
      minimum: 0,
      maximum: 32,
    });
    for (const [name, value] of Object.entries(V8_LOOP_KEYS)) {
      expect(SETTINGS_CATALOG[`mitii.v8LoopPolicy.${name}`]?.default).toBe(value);
    }
  });

  it('rejects invalid entries and leaf/group clashes', () => {
    expect(() => parseSettingsCatalog({ 'mitii.a': { type: 'string' } })).toThrow();
    expect(() =>
      parseSettingsCatalog({ 'other.a': { type: 'string', description: 'x' } }),
    ).toThrow();
    expect(() =>
      parseSettingsCatalog({
        'mitii.a': { type: 'string', description: 'x' },
        'mitii.a.b': { type: 'string', description: 'x' },
      }),
    ).toThrow(/prefix/);
    expect(() =>
      parseSettingsCatalog({
        'mitii.n': { type: 'number', description: 'x', default: 5, maximum: 1 },
      }),
    ).toThrow(/above maximum/);
    expect(() =>
      parseSettingsCatalog({
        'mitii.e': { type: 'string', description: 'x', default: 'z', enum: ['a'] },
      }),
    ).toThrow(/enum/);
    expect(() =>
      parseSettingsCatalog({
        'mitii.u': { type: 'string', description: 'x', surprise: true },
      }),
    ).toThrow();
  });

  it('filters entries by prefix with or without the namespace', () => {
    const a = catalogEntriesForPrefix('v8LoopPolicy');
    const b = catalogEntriesForPrefix('mitii.v8LoopPolicy');
    expect(a).toHaveLength(9);
    expect(b.map((e) => e.key)).toEqual(a.map((e) => e.key));
    expect(a.map((e) => e.shortKey)).toContain('preferredBatchSize');
    expect(catalogEntriesForPrefix('debug').map((e) => e.key)).toEqual(['mitii.debug']);
  });
});

describe('nesting and defaults', () => {
  it('nests flat keys and clones values', () => {
    const servers: unknown[] = [];
    const nested = nestFlatSettings({
      'mitii.tokenBudget.outputRatio': 0.1,
      'mitii.tokenBudget.enabled': false,
      'mitii.debug': true,
      'mitii.mcp': { servers },
    });
    expect(nested).toEqual({
      tokenBudget: { outputRatio: 0.1, enabled: false },
      debug: true,
      mcp: { servers: [] },
    });
    expect((nested.mcp as { servers: unknown[] }).servers).not.toBe(servers);
  });

  it('throws on leaf/group conflicts', () => {
    expect(() => nestFlatSettings({ 'mitii.a': 1, 'mitii.a.b': 2 })).toThrow(/conflicts/);
    expect(() => nestFlatSettings({ 'mitii.a.b': 2, 'mitii.a': 1 })).toThrow(/conflicts/);
    expect(() => nestFlatSettings({ 'mitii.': 1 })).toThrow(/Invalid/);
  });

  it('round-trips catalog defaults through flatten', () => {
    const flat = flattenNestedSettings(DEFAULT_MITII_SETTINGS, Object.keys(SETTINGS_CATALOG));
    for (const [key, entry] of Object.entries(SETTINGS_CATALOG)) {
      expect(flat[key]).toEqual(entry.default);
    }
    expect(nestFlatSettings(flat)).toEqual(DEFAULT_MITII_SETTINGS);
  });

  it('derives defaults from the catalog, including v8LoopPolicy', () => {
    const settings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
    expect(DEFAULT_MITII_SETTINGS.provider.preset).toBe('echo');
    expect(settings.v8LoopPolicy).toEqual(V8_LOOP_KEYS);
    expect(settings.workspace.indexConcurrency).toBe(0);
    expect(settings.loopPolicy.maxReasoningCharsWithoutProgress).toBe(28000);
    expect(settings.tokenBudget.outputRatio).toBe(0.1);
    expect(settings.mcp).toEqual({ enabled: false, servers: [] });
    expect(settings.safety.sandbox.enabled).toBeNull();
  });

  it('layers Desktop defaults over catalog defaults without touching them', () => {
    const desktop: DesktopSettings = DEFAULT_DESKTOP_SETTINGS;
    expect(desktop).not.toBe(DEFAULT_MITII_SETTINGS);
    expect(desktop.provider).toMatchObject({
      type: 'openai-compatible',
      preset: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
    expect(desktop.engine.implementation).toBe('v8');
    expect(getNestedSetting(desktop, 'agent.engineImplementation')).toBeUndefined();
    expect(DEFAULT_MITII_SETTINGS.provider.type).toBe('echo');
    expect(desktop.provider.model).toBe(DEFAULT_MITII_SETTINGS.provider.model);
    for (const key of Object.keys(DESKTOP_DEFAULT_OVERRIDES)) {
      const flatKey = key.startsWith('mitii.') ? key : `mitii.${key}`;
      expect(getNestedSetting(desktop, flatKey)).toBe(DESKTOP_DEFAULT_OVERRIDES[key]);
    }
  });

  it('gets and sets nested values immutably', () => {
    const next = setNestedSetting(DEFAULT_MITII_SETTINGS as Record<string, unknown>, 'mitii.tokenBudget.outputRatio', 0.25);
    expect(getNestedSetting(next, 'tokenBudget.outputRatio')).toBe(0.25);
    expect(getNestedSetting(DEFAULT_MITII_SETTINGS, 'mitii.tokenBudget.outputRatio')).toBe(0.1);
    expect(getNestedSetting(DEFAULT_MITII_SETTINGS, 'mitii.nope.nothing')).toBeUndefined();
  });
});

describe('VS Code contributes projection', () => {
  it('omits null defaults and carries owned fields', () => {
    const props = catalogToContributesProperties();
    expect(props['mitii.safety.sandbox.enabled']).not.toHaveProperty('default');
    expect(props['mitii.tokenBudget.outputRatio']).toMatchObject({
      type: 'number',
      default: 0.1,
      minimum: 0,
      maximum: 1,
    });
  });

  it('reports missing, changed, and extra keys', () => {
    const props: Record<string, Record<string, unknown>> = {
      ...catalogToContributesProperties(),
    };
    delete props['mitii.debug'];
    props['mitii.tokenBudget.outputRatio'] = { ...props['mitii.tokenBudget.outputRatio'], default: 9 };
    props['mitii.ghost'] = { type: 'string' };
    props['editor.unrelated'] = { type: 'string' };
    expect(diffContributesProperties(props)).toEqual(
      expect.arrayContaining([
        { kind: 'missing', key: 'mitii.debug' },
        { kind: 'changed', key: 'mitii.tokenBudget.outputRatio', fields: ['default'] },
        { kind: 'extra', key: 'mitii.ghost' },
      ]),
    );
    expect(diffContributesProperties(props)).toHaveLength(3);
  });

  it('matches apps/vscode/package.json via the check script', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('212 mitii.* keys in sync');
    const manifest = JSON.parse(readFileSync(vscodeManifest, 'utf8'));
    expect(
      diffContributesProperties(manifest.contributes.configuration.properties),
    ).toEqual([]);
  });

  it('fails on drift and patches it with --write', () => {
    const manifest = JSON.parse(readFileSync(vscodeManifest, 'utf8'));
    const props = manifest.contributes.configuration.properties;
    delete props['mitii.debug'];
    props['mitii.v8LoopPolicy.preferredBatchSize'].default = 99;
    props['mitii.v8LoopPolicy.preferredBatchSize'].scope = 'window';
    props['mitii.ghost'] = { type: 'string' };
    const dir = mkdtempSync(join(tmpdir(), 'mitii-settings-'));
    const file = join(dir, 'package.json');
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);

    const failing = spawnSync(process.execPath, [script, '--manifest', file], { encoding: 'utf8' });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain('missing in package.json: mitii.debug');
    expect(failing.stderr).toContain('extra in package.json:   mitii.ghost');
    expect(failing.stderr).toContain('changed: mitii.v8LoopPolicy.preferredBatchSize [default]');

    const patched = spawnSync(process.execPath, [script, '--manifest', file, '--write'], { encoding: 'utf8' });
    expect(patched.status).toBe(0);
    const after = JSON.parse(readFileSync(file, 'utf8')).contributes.configuration.properties;
    expect(after['mitii.ghost']).toBeUndefined();
    expect(after['mitii.debug'].default).toBe(false);
    expect(after['mitii.v8LoopPolicy.preferredBatchSize'].default).toBe(12);
    expect(after['mitii.v8LoopPolicy.preferredBatchSize'].scope).toBe('window');

    const clean = spawnSync(process.execPath, [script, '--manifest', file], { encoding: 'utf8' });
    expect(clean.status).toBe(0);
  });
});
