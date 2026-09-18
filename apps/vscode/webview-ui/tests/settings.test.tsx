import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createProviderHarness } from '../../tests/helpers/settingsHarness';
import { App } from '../src/App';
import { PROVIDER_OPTIONS } from '../src/providerOptions';
import { LOOP_POLICY_FIELDS } from '../../src/loopPolicySettings';
import { SETTINGS_FIELDS } from '../../src/settingsFields';

const bridge = vi.hoisted(() => ({ post: vi.fn(), listener: undefined as any }));
vi.mock('../src/bridge', () => ({
  postToHost: bridge.post,
  onHostMessage: (listener: any) => { bridge.listener = listener; return () => {}; },
}));
// Profile/MCP file storage is tested in host suites. Keep this bridge test in memory.
vi.mock('../../src/profiles', async (original) => ({
  ...await original<any>(),
  readProfiles: (_root: unknown, provider: unknown) => ({ activeProfileId: 'default', profiles: [{ id: 'default', name: 'Default', provider }] }),
  writeProfiles: vi.fn(),
}));
vi.mock('../../src/mcpConfig', async (original) => ({
  ...await original<any>(), writeMcpSettings: vi.fn(),
}));

let harness: ReturnType<typeof createProviderHarness>;
let host: any;
let saves: Promise<void>[];
let mcp = { enabled: false, servers: [] };
const emit = (message: any) => act(() => bridge.listener(message));
async function hydrate() {
  emit({ type: 'settings', provider: await host.readProvider(), autocomplete: host.readAutocomplete(),
    search: await host.readSearch(), ui: host.readUi(), workspace: { root: '/tmp/workspace', rootOverride: harness.store.get('workspace.rootPathOverride') },
    profiles: [], activeProfileId: 'default', mcp, mcpStore: [], mcpRuntimeStatus: 'disabled',
    notice: {}, tokenUsage: host.tokenUsage });
  emit({ type: 'index.status', index: { fileCount: 12, truncated: false,
    maximumIndexFiles: harness.store.get('workspace.maximumIndexFiles') ?? 0,
    embeddingSource: harness.store.get('semanticIndex.source') ?? 'bundled' } });
}
async function open(tab: string) { emit({ type: 'openSettings', tab }); }
async function save() {
  await userEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await act(async () => { await Promise.all(saves); });
  expect(screen.queryByText(/could not be saved/i)).toBeNull();
}
beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  Element.prototype.scrollIntoView = vi.fn();
  harness = createProviderHarness(); host = harness.provider as any;
  host.post = (message: any) => bridge.listener(message);
  saves = []; mcp = { enabled: false, servers: [] };
  bridge.post.mockImplementation((message: any) => {
    if (message.type === 'settings.set') {
      if (message.mcp) mcp = message.mcp;
      saves.push(host.applySettingsSet(message).then(async () => {
        bridge.listener({ type: 'settings.saved', ok: true });
        await hydrate();
      }));
    }
  });
  render(<App />);
  await hydrate();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); bridge.post.mockReset(); });

describe('settings inputs through the host save/read bridge', () => {
  it('keeps every embedding choice through status updates, save, and reopen', async () => {
    await open('workspace');
    for (const source of ['ollama', 'openai-compatible', 'disabled', 'bundled']) {
      fireEvent.change(screen.getByLabelText('Embedding source'), { target: { value: source } });
      emit({ type: 'index.status', index: { fileCount: 25, truncated: false, embeddingSource: 'bundled' } });
      expect((screen.getByLabelText('Embedding source') as HTMLSelectElement).value).toBe(source);
      await save();
      expect(harness.store.get('semanticIndex.source')).toBe(source);
      await open('model'); await open('workspace');
      expect((screen.getByLabelText('Embedding source') as HTMLSelectElement).value).toBe(source);
    }
  });

  it('tests without a model and requires an explicit model on save', async () => {
    harness.store.set('provider.type', 'openai-compatible');
    harness.store.set('provider.preset', 'custom');
    harness.store.set('provider.model', '');
    await hydrate(); await open('model');
    expect((screen.getByLabelText('Model', { exact: true }) as HTMLSelectElement).value).toBe('');
    expect(screen.queryByPlaceholderText('custom model id')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(bridge.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'provider.testConnection', provider: expect.objectContaining({ model: '' }) }));
    emit({ type: 'provider.connectionResult', ok: true, message: 'Connected. Choose a model.', models: ['test-model'] });
    const before = saves.length;
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(saves.length).toBe(before);
    expect(screen.getByText(/Choose a model before saving/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Model', { exact: true }), { target: { value: 'test-model' } });
    await save();
    expect(harness.store.get('provider.model')).toBe('test-model');
  });
});

// Hidden legacy/advanced fields use the host matrix; the UI exposes Simple budget sliders instead.
const inputFields = SETTINGS_FIELDS.filter(field =>
  !['provider.type', 'provider.preset', 'semanticIndex.source', 'semanticIndex.backend', 'semanticIndex.enabled', 'mcp.enabled', 'developer.intensityOverrides', 'ui.effort'].includes(field.id)
  && (!field.id.startsWith('tokenBudget.') || field.id === 'tokenBudget.enabled')
  && (!field.id.startsWith('loopPolicy.') || field.id === 'loopPolicy.enabled' || LOOP_POLICY_FIELDS.some(f => `loopPolicy.${f.key}` === field.id && f.tier !== 'advanced'))
  && !/ui\.modeDefaults\..*\.(depth|thoroughness)$/.test(field.id));
const labels: Record<string, string> = {
  'autocomplete.enabled': 'Enable autocomplete',
  'runBudget.unlimited': 'Unlimited run budget',
};
describe('each editable settings input saves and restores its value', () => {
  it.each(inputFields.map(field => [field.id, field] as const))('%s', async (id, field) => {
    harness.store.set('developer.enabled', true);
    harness.store.set('tokenBudget.enabled', true);
    harness.store.set('loopPolicy.enabled', true);
    if (id === 'provider.baseUrl') { harness.store.set('provider.type', 'openai-compatible'); harness.store.set('provider.preset', 'custom'); }
    await hydrate(); await open(field.tab);
    if (id.startsWith('ui.modeDefaults.')) {
      const mode = id.split('.')[2];
      fireEvent.click(screen.getByRole('tab', { name: mode[0].toUpperCase() + mode.slice(1), exact: true }));
    }
    document.querySelectorAll('details').forEach(el => { el.open = true; });
    let label = labels[id] ?? field.label;
    if (id.endsWith('.approvalMode')) label = 'Approval mode';
    if (/ui\.modeDefaults\..*\.model$/.test(id)) label = 'Default model';
    const getInput = () => screen.getByLabelText(label, { exact: true }) as HTMLInputElement | HTMLSelectElement;
    const input = getInput();
    let expected: string | boolean = String(field.sample);
    if (input instanceof HTMLSelectElement) {
      // Exercise each option, including returning to the original value.
      for (const option of Array.from(input.options).filter(o => o.value !== '__custom__' && (o.value || id !== 'provider.model'))) {
        fireEvent.change(getInput(), { target: { value: option.value } });
        await save();
        expect(getInput().value, `${id} option ${option.value}`).toBe(option.value);
        expect(harness.store.get(id), id).toBe(option.value);
      }
      return;
    }
    if (input.type === 'checkbox') {
      expected = !input.checked;
      fireEvent.click(input);
    } else {
      if (String(expected) === input.value) {
        const value = Number(expected);
        const step = field.kind === 'number' ? 0.01 : 1;
        expected = input.type === 'number' ? String(value + (value + step <= (field.max ?? Infinity) ? step : -step)) : `${expected}-edited`;
      }
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: expected } });
      fireEvent.blur(input);
    }
    await save();
    expect(harness.store.get(id), id).toEqual(input.type === 'checkbox' ? expected : field.kind === 'int' || field.kind === 'number' ? Number(expected) : expected);
    // Remount from persisted host snapshots; local React state cannot make this pass.
    cleanup(); render(<App />); await hydrate(); await open(field.tab);
    if (id.startsWith('ui.modeDefaults.')) {
      const mode = id.split('.')[2];
      fireEvent.click(screen.getByRole('tab', { name: mode[0].toUpperCase() + mode.slice(1), exact: true }));
    }
    expect(input.type === 'checkbox' ? (getInput() as HTMLInputElement).checked : getInput().value).toEqual(expected);
  });
});


describe('simple budget controls and remaining settings', () => {
  it.each([
    ['filesPerMutation', 7], ['outputRatio', 25], ['repositoryShare', 31],
    ['conversationShare', 33], ['planShare', 9], ['skillsShare', 7], ['verificationChecks', 5],
  ])('saves the %s slider and number input', async (key, edited) => {
    harness.store.set('developer.enabled', true);
    await hydrate(); await open('debug');
    const id = `tokenBudget.${key}`;
    fireEvent.change(document.getElementById(id)!, { target: { value: String(edited) } });
    await save();
    cleanup(); render(<App />); await hydrate(); await open('debug');
    expect((document.getElementById(id) as HTMLInputElement).value).toBe(String(edited));
    const number = document.getElementById(id)!.parentElement!.querySelector('input[type=number]')!;
    fireEvent.focus(number);
    fireEvent.change(number, { target: { value: String(Number(edited) + 1) } });
    fireEvent.blur(number);
    await save();
    expect((document.getElementById(id) as HTMLInputElement).value).toBe(String(Number(edited) + 1));
  });

  it('saves SearXNG URL and restores it', async () => {
    await open('model');
    fireEvent.change(screen.getByLabelText('SearXNG base URL'), { target: { value: 'http://localhost:8888' } });
    await save();
    expect(harness.store.get('search.searxngBaseUrl')).toBe('http://localhost:8888');
    expect((screen.getByLabelText('SearXNG base URL') as HTMLInputElement).value).toBe('http://localhost:8888');
  });

  it('saves both states of the MCP switch', async () => {
    await open('integrations');
    for (const enabled of [true, false]) {
      fireEvent.click(screen.getByLabelText('Enable MCP'));
      await save();
      expect(mcp.enabled).toBe(enabled);
      expect((screen.getByLabelText('Enable MCP') as HTMLInputElement).checked).toBe(enabled);
    }
  });
});


describe('provider choices and indexing status', () => {
  it.each(PROVIDER_OPTIONS.map(p => [p.preset, p] as const))('saves and restores the %s provider', async (_id, preset) => {
    await open('model');
    fireEvent.change(document.getElementById('ptype')!, { target: { value: preset.preset } });
    if (!preset.model) {
      expect((screen.getByLabelText('Model', { exact: true }) as HTMLSelectElement).value).toBe('');
      emit({ type: 'provider.connectionResult', ok: true, message: 'Connected', models: ['chosen-model'] });
      fireEvent.change(screen.getByLabelText('Model', { exact: true }), { target: { value: 'chosen-model' } });
    }
    await save();
    expect(harness.store.get('provider.preset')).toBe(preset.preset);
    expect(harness.store.get('provider.type')).toBe(preset.type);
    expect((document.getElementById('ptype') as HTMLSelectElement).value).toBe(preset.preset);
    expect((screen.getByLabelText('Model', { exact: true }) as HTMLSelectElement).value).toBe(preset.model || 'chosen-model');
  });
  it('shows exact discovered and published file counts separately', async () => {
    await open('workspace');
    emit({ type: 'index.status', index: { fileCount: 12, discoveredFileCount: 1234, progressStage: 'indexing', readiness: 'indexing', truncated: true, message: 'Indexing code and text' } });
    expect(screen.getByText('Indexed files')).toBeTruthy();
    expect(screen.getByText('Files discovered in current scan')).toBeTruthy();
    expect(screen.getByText('1234')).toBeTruthy();
    expect(screen.getByText('Yes — scan is incomplete')).toBeTruthy();
    // Header chip is icon-only; file counts live in Workspace settings.
    expect(screen.queryByText('1,234 files')).toBeNull();
  });
  it('keeps the file limit draft through a progress update', async () => {
    await open('workspace');
    const input = screen.getByLabelText('Maximum index files');
    fireEvent.change(input, { target: { value: '12345' } }); fireEvent.blur(input);
    emit({ type: 'index.status', index: { fileCount: 12, truncated: false, maximumIndexFiles: 0 } });
    await save();
    expect(harness.store.get('workspace.maximumIndexFiles')).toBe(12345);
    expect((screen.getByLabelText('Maximum index files') as HTMLInputElement).value).toBe('12345');
  });
});


it('saves a manually entered custom model ID', async () => {
  await open('model');
  fireEvent.change(screen.getByLabelText('Model', { exact: true }), { target: { value: '__custom__' } });
  fireEvent.change(screen.getByLabelText('Custom model ID'), { target: { value: 'my-custom-model' } });
  await save();
  expect(harness.store.get('provider.model')).toBe('my-custom-model');
});

it('allows Full access to be selected while running', async () => {
  emit({ type: 'run.started', mode: 'agent', prompt: 'test access' });
  await userEvent.click(screen.getByRole('button', { name: 'Approval', exact: true }));
  await userEvent.click(screen.getByRole('option', { name: /Full access/ }));
  await act(async () => { await Promise.all(saves); });
  expect(harness.store.get('safety.approvalMode')).toBe('pilot');
});
