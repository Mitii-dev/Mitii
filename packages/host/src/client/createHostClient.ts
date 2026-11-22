import {
  createMitiiClient,
  DEFAULT_TOOL_DEFINITIONS,
  InMemoryRepositoryStateStore,
  InMemoryToolOutputSpillAdapter,
  NodeNetworkAdapter,
  NodeProcessAdapter,
  NodeWorkspaceFileSystemAdapter,
  RepositoryStatePipeline,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceFileSystemManifestReader,
  type CreateMitiiClientOptions,
  type MemoryStorePort,
  type ModelToolDefinition,
} from '@mitii/sdk';

import { createHostLanguageServices } from '../code-navigation/createHostLanguageServices.js';
import { createWorkspaceCheckpointStore } from '../ports/checkpoints.js';
import { createWorkspaceMemoryStore } from '../ports/memoryStore.js';
import { createHostNetworkPort } from '../ports/network.js';
import { resolveMemoryEmbeddingPort } from '../ports/resolveMemoryEmbedding.js';
import { createOptionalSearchPort } from '../ports/search.js';
import { createFileSystemSkillsCatalog } from '../ports/skillsCatalog.js';
import { createWorkspaceKnowledgeGraph } from '../ports/knowledgeGraphStore.js';
import { createWorkspaceVerificationStore } from '../ports/verificationRecords.js';
import { createOptionalVerificationSyntaxPort } from '../ports/verificationSyntax.js';
import { AstGrepWorkspaceAdapter } from '../ports/AstGrepWorkspaceAdapter.js';
import { CompositeWorkspaceTextSearchAdapter } from '../ports/CompositeWorkspaceTextSearchAdapter.js';
import { RipgrepWorkspaceTextSearchAdapter } from '../ports/RipgrepWorkspaceTextSearchAdapter.js';
import { createHostGitPort } from '../ports/createHostGitPort.js';
import { createHostRepositoryGraphPort } from '../repository-graph/loadWorkspaceGraphs.js';
import {
  createSandboxedProcessPort,
  detectSandboxBackend,
  resolveSandboxPolicy,
} from '../sandbox/createSandboxedProcessPort.js';
import {
  HostClientOptionsError,
  hostClientScalarOptionsSchema,
  type CreateHostClientOptions,
  type HostClientComposition,
  type HostClientReasonCode,
  type HostMcpPort,
  type HostMcpSnapshot,
  type HostSandboxOptions,
} from './contracts.js';

const SANDBOX_BACKENDS = new Set([
  'auto',
  'docker',
  'podman',
  'seatbelt',
  'bubblewrap',
]);

/** Parse the shared `MITII_SANDBOX*` env contract used by CLI / ACP / Desktop. */
export function readSandboxOptionsFromEnv(
  env: NodeJS.ProcessEnv,
): HostSandboxOptions {
  const backend = env.MITII_SANDBOX_BACKEND;
  return {
    enabled: env.MITII_SANDBOX === '1' || env.MITII_SANDBOX === 'true',
    network: env.MITII_SANDBOX_NETWORK === 'allow' ? 'allow' : 'deny',
    prefer:
      backend && SANDBOX_BACKENDS.has(backend)
        ? (backend as HostSandboxOptions['prefer'])
        : 'auto',
  };
}

/** Bind a concrete MCP manager + settings into the factory's `HostMcpPort`. */
export function bindHostMcp<TSettings>(
  manager: {
    sync(
      settings: TSettings,
      workspaceRoot?: string,
    ): Promise<HostMcpSnapshot>;
    createRegistry: HostMcpPort['createRegistry'];
  },
  settings: TSettings,
  workspaceRoot?: string,
): HostMcpPort {
  return {
    sync: () => manager.sync(settings, workspaceRoot),
    createRegistry: () => manager.createRegistry(),
  };
}

function reasonForPath(path: ReadonlyArray<string | number>): HostClientReasonCode {
  const head = path[0];
  if (head === 'workspaceId') return 'invalid_workspace_id';
  if (head === 'sandbox') return 'invalid_sandbox';
  return 'invalid_default_mode';
}

function validateScalars(options: CreateHostClientOptions): void {
  const parsed = hostClientScalarOptionsSchema.safeParse({
    workspaceId: options.workspaceId,
    defaultMode: options.defaultMode,
    defaultSessionId: options.defaultSessionId,
    taskListAutoAdvance: options.taskListAutoAdvance,
    sandbox: options.sandbox,
  });
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  throw new HostClientOptionsError(
    reasonForPath(issue?.path ?? []),
    `createHostClient: ${issue?.path.join('.') || 'options'}: ${issue?.message ?? 'invalid'}`,
  );
}

/**
 * Compose the common host wiring around `createMitiiClient`: tool runtime,
 * verification, in-memory repository state, skills, memory, sandboxed process,
 * and MCP registry. Hosts inject host-specific ports, secrets, and overrides.
 *
 * Without a `workspaceRoot` the factory returns a chat-only client (no tool
 * runtime, verification, graphs, or durable stores).
 */
export async function createHostClient(
  options: CreateHostClientOptions,
): Promise<HostClientComposition> {
  validateScalars(options);
  const env = options.env ?? process.env;
  const root = options.workspaceRoot;

  const repositoryState = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });

  const mcpSnapshot = options.mcp ? await options.mcp.sync() : undefined;
  const mcpToolDefinitions: readonly ModelToolDefinition[] =
    mcpSnapshot?.toolDefinitions ?? [];

  const skillsCatalog =
    options.skills?.catalog ??
    createFileSystemSkillsCatalog({
      workspaceRoot:
        (options.skills?.workspaceSkills ?? true) ? root : undefined,
      contentMode: 'metadata',
    });

  let memoryStore: MemoryStorePort | undefined;
  let memoryEmbedding: CreateMitiiClientOptions['memoryEmbedding'];
  if (options.memory) {
    memoryStore =
      options.memory.store ??
      (root ? createWorkspaceMemoryStore(root, options.workspaceId) : undefined);
    memoryEmbedding = resolveMemoryEmbeddingPort(options.memory.semanticIndex);
  }

  let tools: ToolRuntimePipeline | undefined;
  let verification: VerificationPipeline | undefined;
  let git: ReturnType<typeof createHostGitPort> | undefined;
  let repoGraphs: ReturnType<typeof createHostRepositoryGraphPort> | undefined;

  if (root) {
    const fileSystem = new NodeWorkspaceFileSystemAdapter();
    git = createHostGitPort();
    const workspaceTextSearch = new CompositeWorkspaceTextSearchAdapter(
      new RipgrepWorkspaceTextSearchAdapter(fileSystem),
    );
    const astGrep = new AstGrepWorkspaceAdapter();
    repoGraphs = createHostRepositoryGraphPort({
      workspaceRoot: root,
      git,
    });
    const sandbox = options.sandbox ?? {};
    const processPort =
      options.processPort ??
      createSandboxedProcessPort(
        new NodeProcessAdapter(),
        resolveSandboxPolicy({
          enabled: sandbox.enabled === true,
          network: sandbox.network ?? 'deny',
          workspaceRoot: root,
        }),
        detectSandboxBackend({ prefer: sandbox.prefer ?? 'auto' }),
      );
    const search = createOptionalSearchPort({
      env,
      ...(options.search?.apiKey ? { apiKey: options.search.apiKey } : {}),
      ...(options.search?.searxngBaseUrl
        ? { config: { searxngBaseUrl: options.search.searxngBaseUrl } }
        : {}),
    });
    const language = options.codeNavigation
      ? undefined
      : createHostLanguageServices({ workspaceRoot: root });
    const codeNavigation = options.codeNavigation ?? language?.codeNavigation;
    const diagnostics = options.diagnostics ?? language?.diagnostics;

    tools = new ToolRuntimePipeline(
      {
        fileSystem,
        process: processPort,
        network:
          options.network ??
          createHostNetworkPort({ inner: new NodeNetworkAdapter(), env }),
        git,
        workspaceTextSearch,
        astGrep,
        knowledgeGraph: createWorkspaceKnowledgeGraph(root),
        ...(codeNavigation ? { codeNavigation } : {}),
        ...(diagnostics ? { diagnostics } : {}),
        repoGraphs,
        outputSpill: new InMemoryToolOutputSpillAdapter(),
        ...(search ? { search } : {}),
      },
      {
        ...(options.mcp ? { registry: options.mcp.createRegistry() } : {}),
        ...(options.fuzzyMatchDefault !== undefined
          ? { fuzzyMatchDefault: options.fuzzyMatchDefault }
          : {}),
      },
    );
    const syntax = await createOptionalVerificationSyntaxPort();
    verification = new VerificationPipeline({
      tools,
      manifests: new WorkspaceFileSystemManifestReader({
        fileSystem,
        workspaceRoot: root,
      }),
      records: createWorkspaceVerificationStore(root),
      ...(syntax ? { syntax } : {}),
    });
  }

  const repositoryContext =
    root && git && options.repositoryContext
      ? options.repositoryContext({ repositoryState, workspaceRoot: root, git })
      : undefined;

  const client = createMitiiClient({
    understandingLlm: options.llm.understandingLlm,
    runLlm: options.llm.runLlm,
    workspaceRoot: root,
    defaultMode: options.defaultMode ?? 'ask',
    ...(options.defaultSessionId
      ? { defaultSessionId: options.defaultSessionId }
      : {}),
    workspaceId: options.workspaceId,
    repositoryState,
    ...(repositoryContext ? { repositoryContext } : {}),
    tools,
    ...(repoGraphs ? { repoGraphs } : {}),
    verification,
    toolDefinitions: [...DEFAULT_TOOL_DEFINITIONS, ...mcpToolDefinitions],
    enableInMemoryCheckpoints: false,
    ...(root ? { checkpointStore: createWorkspaceCheckpointStore(root) } : {}),
    ...(options.taskListAutoAdvance !== undefined
      ? { taskListAutoAdvance: options.taskListAutoAdvance }
      : {}),
    skillsCatalog,
    memoryStore,
    memoryEmbedding,
    ...options.clientOptions,
  });

  return {
    client,
    repositoryState,
    ...(tools ? { tools } : {}),
    ...(verification ? { verification } : {}),
    ...(git ? { git } : {}),
    mcpToolDefinitions,
    ...(memoryStore ? { memoryStore } : {}),
    ...(memoryEmbedding ? { memoryEmbedding } : {}),
  };
}
