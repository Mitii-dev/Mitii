import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EchoLlmPort,
  ToolRegistry,
  type LlmPort,
  type ModelCapabilities,
  type ModelEvent,
  type ModelRequest,
} from '@mitii/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HostClientOptionsError,
  bindHostMcp,
  createHostClient,
  readSandboxOptionsFromEnv,
} from './index.js';

class StubUnderstandingPort implements LlmPort {
  readonly id = 'stub-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'stub/understanding',
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };
  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield { type: 'completed', finishReason: 'stop' };
  }
}

const llm = () => ({
  understandingLlm: new StubUnderstandingPort(),
  runLlm: new EchoLlmPort(),
});

describe('createHostClient', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mitii-host-client-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('composes tools, verification, git and repository state for a workspace', async () => {
    const result = await createHostClient({
      workspaceRoot: root,
      workspaceId: 'ws_test',
      llm: llm(),
      env: {},
      defaultSessionId: 'host_session',
    });
    expect(result.client).toBeDefined();
    expect(result.tools).toBeDefined();
    expect(result.verification).toBeDefined();
    expect(result.git).toBeDefined();
    expect(result.repositoryState).toBeDefined();
    expect(result.memoryStore).toBeUndefined();
    expect(result.mcpToolDefinitions).toEqual([]);
  });

  it('returns a chat-only composition without a workspace root', async () => {
    const result = await createHostClient({
      workspaceRoot: undefined,
      workspaceId: 'ws_test',
      llm: llm(),
      env: {},
    });
    expect(result.client).toBeDefined();
    expect(result.tools).toBeUndefined();
    expect(result.verification).toBeUndefined();
    expect(result.git).toBeUndefined();
  });

  it('wires durable memory only when requested', async () => {
    const on = await createHostClient({
      workspaceRoot: root,
      workspaceId: 'ws_test',
      llm: llm(),
      env: {},
      memory: {},
    });
    expect(on.memoryStore).toBeDefined();
    expect(on.memoryEmbedding).toBeDefined();
  });

  it('syncs MCP once and merges tool definitions + registry', async () => {
    const registry = new ToolRegistry();
    const sync = vi.fn(async () => ({ toolDefinitions: [] }));
    const createRegistry = vi.fn(() => registry);
    const result = await createHostClient({
      workspaceRoot: root,
      workspaceId: 'ws_test',
      llm: llm(),
      env: {},
      mcp: bindHostMcp({ sync, createRegistry }, { enabled: true }, root),
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith({ enabled: true }, root);
    expect(createRegistry).toHaveBeenCalledTimes(1);
    expect(result.tools).toBeDefined();
  });

  it('uses host-provided process port, repository context factory and overrides', async () => {
    const processPort = {
      exec: vi.fn(),
    } as unknown as NonNullable<
      Parameters<typeof createHostClient>[0]['processPort']
    >;
    const repositoryContext = vi.fn(() => undefined);
    await createHostClient({
      workspaceRoot: root,
      workspaceId: 'ws_test',
      llm: llm(),
      env: {},
      processPort,
      repositoryContext,
      clientOptions: { defaultSessionId: 'override_session' },
    });
    expect(repositoryContext).toHaveBeenCalledTimes(1);
    const deps = repositoryContext.mock.calls[0]?.[0] as unknown as {
      workspaceRoot: string;
    };
    expect(deps.workspaceRoot).toBe(root);
  });

  it.each([
    [{ workspaceId: '   ' }, 'invalid_workspace_id'],
    [{ defaultMode: 'bogus' as never }, 'invalid_default_mode'],
    [{ sandbox: { network: 'maybe' as never } }, 'invalid_sandbox'],
  ] as const)('rejects invalid options %#', async (patch, code) => {
    const attempt = createHostClient({
      workspaceRoot: root,
      workspaceId: 'ws_test',
      llm: llm(),
      env: {},
      ...patch,
    });
    await expect(attempt).rejects.toBeInstanceOf(HostClientOptionsError);
    await expect(attempt).rejects.toMatchObject({ code });
  });
});

describe('readSandboxOptionsFromEnv', () => {
  it('defaults to disabled / deny / auto', () => {
    expect(readSandboxOptionsFromEnv({})).toEqual({
      enabled: false,
      network: 'deny',
      prefer: 'auto',
    });
  });

  it('reads enable, network and backend', () => {
    expect(
      readSandboxOptionsFromEnv({
        MITII_SANDBOX: 'true',
        MITII_SANDBOX_NETWORK: 'allow',
        MITII_SANDBOX_BACKEND: 'podman',
      }),
    ).toEqual({ enabled: true, network: 'allow', prefer: 'podman' });
  });

  it('ignores unknown backends', () => {
    expect(
      readSandboxOptionsFromEnv({ MITII_SANDBOX_BACKEND: 'wasm' }).prefer,
    ).toBe('auto');
  });
});
