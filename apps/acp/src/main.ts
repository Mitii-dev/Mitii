/**
 * apps/acp — Mitii ACP-lite stdio bridge.
 *
 * Not the full Agent Client Protocol. Line-delimited JSON over stdin/stdout.
 * Decision Policy remains authority; V8 does not import ACP.
 *
 * Depends on @mitii/sdk + @mitii/host + @mitii/mcp. Does not import apps/cli.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as readline from 'node:readline';

import {
  createMitiiClient,
  DEFAULT_TOOL_DEFINITIONS,
  EchoLlmPort,
  InMemoryRepositoryStateStore,
  NodeGitAdapter,
  NodeNetworkAdapter,
  NodeProcessAdapter,
  NodeWorkspaceFileSystemAdapter,
  RepositoryStatePipeline,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceFileSystemManifestReader,
  type AgentMode,
  type LlmPort,
  type MitiiClient,
  type ModelCapabilities,
  type ModelEvent,
  type ModelRequest,
} from '@mitii/sdk';
import {
  createFileSystemSkillsCatalog,
  createHostLanguageServices,
  createHostLlmPorts,
  createHostNetworkPort,
  createHostRepositoryGraphPort,
  createOptionalSearchPort,
  createSandboxedProcessPort,
  createWorkspaceCheckpointStore,
  createWorkspaceKnowledgeGraph,
  createWorkspaceVerificationStore,
  detectSandboxBackend,
  getProviderPreset,
  inferHostProviderType,
  isHostProviderType,
  resolveProviderApiKey,
  resolveSandboxPolicy,
} from '@mitii/host';
import {
  getSharedMcpManager,
  readMcpSettingsFromDisk,
} from '@mitii/mcp';

interface AcpRequest {
  op: string;
  id?: string;
  prompt?: string;
  mode?: AgentMode;
}

interface MitiiAcpConfig {
  provider?: string;
  providerPreset?: string;
  model?: string;
  baseUrl?: string;
  workspaceId?: string;
  defaultMode?: AgentMode;
}

/** Deterministic understanding for echo / smoke (mirrors CLI local port). */
class AcpUnderstandingLlmPort implements LlmPort {
  readonly id = 'acp-local-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'acp/local-understanding',
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
    yield {
      type: 'content_delta',
      content: JSON.stringify({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        secondaryTaskIntents: [],
        confidence: 0.95,
        alternatives: [],
        needsClarification: false,
        reason: 'ACP-lite local understanding (echo).',
      }),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

function loadMitiiConfig(cwd: string): MitiiAcpConfig {
  const path = join(cwd, '.mitii', 'config.json');
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      provider: typeof raw.provider === 'string' ? raw.provider : undefined,
      providerPreset:
        typeof raw.providerPreset === 'string' ? raw.providerPreset : undefined,
      model: typeof raw.model === 'string' ? raw.model : undefined,
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
      workspaceId:
        typeof raw.workspaceId === 'string' ? raw.workspaceId : undefined,
      defaultMode:
        raw.defaultMode === 'ask' ||
        raw.defaultMode === 'plan' ||
        raw.defaultMode === 'agent'
          ? raw.defaultMode
          : undefined,
    };
  } catch {
    return {};
  }
}

function createEchoClient(cwd: string): MitiiClient {
  return createMitiiClient({
    understandingLlm: new AcpUnderstandingLlmPort(),
    runLlm: new EchoLlmPort(),
    workspaceRoot: cwd,
    defaultMode: 'ask',
    defaultSessionId: 'acp_session',
    workspaceId: 'acp_workspace',
  });
}

async function createHostAcpClient(cwd: string): Promise<MitiiClient> {
  const env = process.env;
  const config = loadMitiiConfig(cwd);
  const type =
    (env.MITII_PROVIDER && isHostProviderType(env.MITII_PROVIDER)
      ? env.MITII_PROVIDER
      : undefined) ??
    (config.provider && isHostProviderType(config.provider)
      ? config.provider
      : undefined) ??
    inferHostProviderType(env) ??
    'echo';
  const forceEcho =
    env.MITII_FORCE_ECHO === '1' ||
    type === 'echo' ||
    config.provider === 'echo';
  const presetId =
    env.MITII_PROVIDER_PRESET ?? config.providerPreset ?? type;
  const preset = getProviderPreset(presetId);
  const model =
    env.MITII_MODEL ?? config.model ?? preset?.model ?? 'gpt-4o-mini';
  const baseUrl = env.MITII_BASE_URL ?? config.baseUrl ?? preset?.baseUrl;
  const apiKey = resolveProviderApiKey({ type, env });

  const llm = forceEcho
    ? {
        understandingLlm: new AcpUnderstandingLlmPort(),
        runLlm: new EchoLlmPort(),
      }
    : createHostLlmPorts({
        type,
        preset: presetId,
        model,
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      });

  const mcpManager = getSharedMcpManager({ clientInfoName: 'mitii-acp' });
  const mcp = readMcpSettingsFromDisk(cwd);
  const mcpSnapshot = await mcpManager.sync(mcp, cwd);

  const fileSystem = new NodeWorkspaceFileSystemAdapter();
  const search = createOptionalSearchPort(env);
  const git = new NodeGitAdapter();
  const knowledgeGraph = createWorkspaceKnowledgeGraph(cwd);
  const language = createHostLanguageServices({ workspaceRoot: cwd });
  const tools = new ToolRuntimePipeline(
    {
      fileSystem,
      process: createSandboxedProcessPort(
        new NodeProcessAdapter(),
        resolveSandboxPolicy({
          enabled: env.MITII_SANDBOX === '1' || env.MITII_SANDBOX === 'true',
          network: env.MITII_SANDBOX_NETWORK === 'allow' ? 'allow' : 'deny',
          workspaceRoot: cwd,
        }),
        detectSandboxBackend(),
      ),
      network: createHostNetworkPort({
        inner: new NodeNetworkAdapter(),
        env,
      }),
      git,
      knowledgeGraph,
      codeNavigation: language.codeNavigation,
      ...(language.diagnostics ? { diagnostics: language.diagnostics } : {}),
      repoGraphs: createHostRepositoryGraphPort({ workspaceRoot: cwd }),
      ...(search ? { search } : {}),
    },
    { registry: mcpManager.createRegistry() },
  );
  const verification = new VerificationPipeline({
    tools,
    manifests: new WorkspaceFileSystemManifestReader({
      fileSystem,
      workspaceRoot: cwd,
    }),
    records: createWorkspaceVerificationStore(cwd),
  });
  const repositoryState = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });

  return createMitiiClient({
    understandingLlm: llm.understandingLlm,
    runLlm: llm.runLlm,
    workspaceRoot: cwd,
    defaultMode: config.defaultMode === 'agent' ? 'agent' : config.defaultMode ?? 'ask',
    defaultSessionId: 'acp_session',
    workspaceId: config.workspaceId ?? 'acp_workspace',
    repositoryState,
    tools,
    verification,
    toolDefinitions: [
      ...DEFAULT_TOOL_DEFINITIONS,
      ...mcpSnapshot.toolDefinitions,
    ],
    enableInMemoryCheckpoints: false,
    checkpointStore: createWorkspaceCheckpointStore(cwd),
    skillsCatalog: createFileSystemSkillsCatalog({
      workspaceRoot: cwd,
      contentMode: 'metadata',
    }),
  });
}

function writeLine(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function parseLine(line: string): AcpRequest | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { error: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'expected_object' };
  }
  const record = parsed as Record<string, unknown>;
  const op = typeof record.op === 'string' ? record.op : '';
  if (!op) return { error: 'missing_op' };
  return {
    op,
    id: typeof record.id === 'string' ? record.id : undefined,
    prompt: typeof record.prompt === 'string' ? record.prompt : undefined,
    mode:
      record.mode === 'ask' ||
      record.mode === 'plan' ||
      record.mode === 'agent'
        ? record.mode
        : undefined,
  };
}

async function handlePrompt(
  client: MitiiClient,
  req: AcpRequest,
): Promise<void> {
  const id = req.id ?? 'anon';
  const prompt = req.prompt?.trim();
  if (!prompt) {
    writeLine({
      op: 'error',
      id,
      error: 'prompt_required',
    });
    return;
  }
  const mode = req.mode ?? 'ask';
  const run = client.start({
    prompt,
    mode,
    workspaceRoot: process.cwd(),
  });
  for await (const event of run.events) {
    writeLine({ op: 'event', id, event });
  }
  const result = await run.result;
  writeLine({ op: 'result', id, result });
}

function wantsEcho(argv: readonly string[]): boolean {
  return argv.includes('--echo');
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const echo = wantsEcho(process.argv.slice(2));
  const client = echo ? createEchoClient(cwd) : await createHostAcpClient(cwd);
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  writeLine({
    op: 'ready',
    protocol: 'mitii-acp-lite',
    version: 1,
    mode: echo ? 'echo' : 'host',
    note: 'ACP-lite bridge; Decision Policy remains authority; V8 does not import ACP.',
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const req = parseLine(trimmed);
    if ('error' in req) {
      writeLine({ op: 'error', error: req.error });
      continue;
    }
    if (req.op === 'ping') {
      writeLine({ op: 'pong', id: req.id });
      continue;
    }
    if (req.op === 'prompt') {
      await handlePrompt(client, req);
      continue;
    }
    writeLine({
      op: 'error',
      id: req.id,
      error: 'unknown_op',
      opReceived: req.op,
    });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeLine({ op: 'error', error: 'fatal', message });
  process.exitCode = 1;
});
