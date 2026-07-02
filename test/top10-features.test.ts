import { describe, expect, it, vi } from 'vitest';
import { validateProviderSettings } from '../src/core/config/ui/mappers';
import { detectEditorRebuildCommand } from '../src/vscode/nativeModuleHealth';
import { parseReviewDiffFiles } from '../src/core/scm/ReviewDiffCollector';
import { OpenAiCompatibleProvider } from '../src/core/llm/OpenAiCompatibleProvider';
import { HeadlessAgentRunner } from '../src/core/headless';
import { createProvider } from '../src/core/llm/createProvider';
import { detectModelCapabilities } from '../src/core/llm/modelCapabilities';
import { WebhookEmitter } from '../src/core/telemetry/WebhookEmitter';

describe('provider setup validation', () => {
  it('requires provider-specific fields', () => {
    expect(validateProviderSettings({
      providerType: 'azure-openai',
      baseUrl: 'not-a-url',
      model: '',
      apiVersion: '',
      region: 'us-east-1',
      contextWindow: 512,
    }).errors).toEqual(expect.arrayContaining([
      'API base URL must be a valid URL.',
      'Azure deployment name is required.',
      'Azure API version is required.',
      'Context window must be at least 1024 tokens.',
    ]));
  });

  it('accepts a complete local OpenAI-compatible preset', () => {
    expect(validateProviderSettings({
      providerType: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3-coder:30b',
      contextWindow: 8192,
    }).ok).toBe(true);
  });
});

describe('native module health helpers', () => {
  it('uses a Cursor-specific rebuild command when Cursor env is present', () => {
    expect(detectEditorRebuildCommand({ CURSOR_TRACE_ID: '1' } as NodeJS.ProcessEnv)).toBe(
      'THUNDER_EDITOR=cursor npm run rebuild:native'
    );
  });
});

describe('review diff parsing', () => {
  it('groups file diffs and counts changed lines', () => {
    const files = parseReviewDiffFiles([
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1,2 @@',
      '-old',
      '+new',
      '+next',
      '',
    ].join('\n'), ['M\tsrc/a.ts']);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'src/a.ts', status: 'M', additions: 2, deletions: 1 });
  });
});

describe('multimodal provider payloads', () => {
  it('formats image attachments for OpenAI-compatible providers', async () => {
    const provider = new OpenAiCompatibleProvider({
      baseUrl: 'https://example.test/v1',
      model: 'vision-model',
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      for await (const _delta of provider.complete({
        stream: false,
        messages: [{
          role: 'user',
          content: 'what is this?',
          attachments: [{ kind: 'image', mimeType: 'image/png', data: 'abc123', name: 'screen.png' }],
        }],
      })) {
        // consume
      }
    } finally {
      vi.unstubAllGlobals();
    }

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: 'what is this?' });
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,abc123');
  });
});

describe('headless runner', () => {
  it('returns deterministic echo answers and JSON plans without VS Code APIs', async () => {
    const runner = new HeadlessAgentRunner({ cwd: process.cwd(), providerType: 'echo' });
    await expect(runner.ask('hello')).resolves.toContain('Echo: hello');

    const plan = runner.plan('ship a feature');
    expect(plan.steps.map((step) => step.id)).toEqual(['discover', 'design', 'execute', 'verify']);
  });
});

describe('model capability detection', () => {
  it('detects vision and reasoning support while respecting overrides', () => {
    const detected = detectModelCapabilities('openai', 'gpt-4.1', 128_000);
    expect(detected.supportsVision).toBe(true);
    expect(detected.supportsReasoning).toBe(false);

    const reasoner = createProvider({
      type: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3-coder:30b',
      supportsVision: false,
      supportsReasoning: true,
    });
    expect(reasoner.capabilities.supportsReasoning).toBe(true);
    expect(reasoner.capabilities.supportsVision).toBe(false);
  });
});

describe('telemetry webhook emitter', () => {
  it('posts sanitized events with an HMAC signature header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const emitter = new WebhookEmitter();
    emitter.configure({ url: 'https://siem.example.test/events', secret: 'secret' });

    try {
      emitter.emit({
        ts: 1,
        time: '2026-07-02 00:00:00.000',
        sessionId: 's1',
        type: 'tool_end',
        message: 'Tool finished',
        data: { tool: 'read_file' },
      });
      await emitter.flush();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://siem.example.test/events');
    expect(fetchMock.mock.calls[0][1].headers['X-Mitii-Signature']).toMatch(/^sha256=/);
  });
});
