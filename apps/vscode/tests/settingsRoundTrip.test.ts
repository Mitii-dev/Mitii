import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_FIELDS } from '../src/settingsFields';
import { createProviderHarness } from './helpers/settingsHarness';

const properties = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).contributes.configuration.properties;
function nested(path: string[], value: unknown): any {
  return path.reduceRight((child, key) => ({ [key]: child }), value);
}
function patchFor(id: string, value: unknown): any {
  if (id.startsWith('provider.') || id.startsWith('autocomplete.')) return nested(id.split('.'), value);
  if (id === 'workspace.rootPathOverride') return { workspaceRootOverride: value };
  if (id === 'workspace.maximumIndexFiles') return { workspaceMaximumIndexFiles: value };
  if (id === 'semanticIndex.source') return { semanticIndex: { source: value } };
  if (id.startsWith('ui.')) return nested(id.split('.'), value);
  if (id.startsWith('runBudget.')) return { ui: nested(id.split('.'), value) };
  for (const group of ['tokenBudget', 'loopPolicy']) {
    if (id.startsWith(`${group}.`)) {
      const key = id.slice(group.length + 1);
      return { ui: { [group]: key === 'enabled' ? { enabled: value } : { enabled: true, [group === 'tokenBudget' ? 'policy' : 'thresholds']: { [key]: value } } } };
    }
  }
  const names: Record<string, string> = { 'developer.enabled': 'developerEnabled', 'developer.intensityOverrides': 'intensityOverrides', 'developer.modelIo': 'modelIoLogging', debug: 'debugLogging' };
  if (names[id]) return { ui: { [names[id]]: value } };
  throw new Error(`No real save mapping for ${id}`);
}
const editable = SETTINGS_FIELDS.filter(f => !['semanticIndex.backend', 'semanticIndex.enabled', 'mcp.enabled'].includes(f.id));
const cases = editable.flatMap(field => {
  const schema = properties[`mitii.${field.setting}`];
  const values = field.kind === 'boolean' ? [false, true] : schema?.enum ?? [field.sample];
  return values.map((value: unknown) => [field.id, value] as const);
});
describe('registered settings through the actual sidebar writer', () => {
  it.each(SETTINGS_FIELDS.map(f => [f.id, f.setting]))('%s has a VS Code registration', (_id, key) => {
    expect(properties[`mitii.${key === 'mcp.enabled' ? 'mcp' : key}`]).toBeDefined();
  });
  it.each(cases)('saves %s = %s and reads it back from configuration', async (id, value) => {
    const { provider, store, cfg } = createProviderHarness();
    store.set('developer.intensityOverrides', true);
    const host = provider as any;
    await host.applySettingsSet({ type: 'settings.set', ...patchFor(id, value) });
    expect(cfg.get(id), id).toEqual(value);
    const ui = host.readUi();
    if (id.startsWith('ui.')) {
      expect(id.slice(3).split('.').reduce((v: any, k) => v[k], ui)).toEqual(value);
    } else if (id.startsWith('autocomplete.')) {
      expect(host.readAutocomplete()[id.slice(13)]).toEqual(value);
    } else if (id.startsWith('provider.')) {
      expect((await host.readProvider())[id.slice(9)]).toEqual(value);
    } else if (id === 'semanticIndex.source') {
      expect((await host.withEmbedding({ fileCount: 0, truncated: false })).embeddingSource).toEqual(value);
    }
  });

  it('applies full access to a pending approval even if stale mode registration fails', async () => {
    const { provider, cfg, store } = createProviderHarness();
    const host = provider as any;
    const resume = vi.fn();
    host.pendingResume = { resolve: resume };
    host.pendingSuspension = { kind: 'approval_required', runId: 'run-1', approval: { approvalId: 'approval-1' } };
    const update = cfg.update;
    cfg.update = vi.fn(async (key, value, target) => {
      if (key.startsWith('ui.modeDefaults')) throw new Error(`${key} is not a registered configuration`);
      return update(key, value, target);
    });
    await expect(host.applySettingsSet({ type: 'settings.set', approvalMode: 'pilot', ui: { modeDefaults: { agent: { approvalMode: 'pilot' } } } })).rejects.toThrow(/Reload the VS Code window/);
    expect(store.get('safety.approvalMode')).toBe('pilot');
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ approvalMode: 'never', approval: { approvalId: 'approval-1', decision: 'approved' } }));
  });
});


describe('access changes during an active run', () => {
  const suspension = { kind: 'approval_required', runId: 'run-2', approval: { approvalId: 'approval-2' } };
  it('applies full access selected while a model call was in flight to the next approval', async () => {
    const { provider } = createProviderHarness();
    const host = provider as any;
    host.runCancel = {};
    await host.applySettingsSet({ type: 'settings.set', approvalMode: 'pilot' });
    await expect(host.waitForSuspensionResume(suspension)).resolves.toMatchObject({ approvalMode: 'never', approval: { decision: 'approved' } });
  });
  it('does not use stale global Full access to bypass a new run mode default', async () => {
    const { provider, store } = createProviderHarness();
    const host = provider as any;
    store.set('safety.approvalMode', 'pilot');
    const result = host.waitForSuspensionResume(suspension);
    const resolved = vi.fn();
    result.then(resolved);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    host.pendingResume.resolve('stop');
    await result;
  });
  it('does not auto-approve after switching back from full access', async () => {
    const { provider } = createProviderHarness();
    const host = provider as any;
    host.runCancel = {};
    await host.applySettingsSet({ type: 'settings.set', approvalMode: 'pilot' });
    await host.applySettingsSet({ type: 'settings.set', approvalMode: 'guided' });
    const result = host.waitForSuspensionResume(suspension);
    expect(host.pendingResume).toBeDefined();
    host.pendingResume.resolve('stop');
    await expect(result).resolves.toBe('stop');
  });
});
