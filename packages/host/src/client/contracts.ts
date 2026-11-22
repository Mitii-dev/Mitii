import type {
  AgentMode,
  CreateMitiiClientOptions,
  LlmPort,
  MitiiClient,
  MemoryStorePort,
  RepositoryStatePipeline,
  ModelToolDefinition,
  ToolRuntimePipeline,
  VerificationPipeline,
  GitPort,
  SkillsCatalogPort,
} from '@mitii/sdk';
import { z } from 'zod';

import type { SemanticIndexSettings } from '../indexing/semanticIndex.js';
import type { SandboxBackendPrefer } from '../sandbox/createSandboxedProcessPort.js';

export const HOST_CLIENT_REASON_CODES = [
  'invalid_workspace_id',
  'invalid_default_mode',
  'invalid_sandbox',
  'workspace_root_required',
] as const;
export type HostClientReasonCode = (typeof HOST_CLIENT_REASON_CODES)[number];

/** Thrown when `createHostClient` options fail boundary validation. */
export class HostClientOptionsError extends Error {
  constructor(
    readonly code: HostClientReasonCode,
    message: string,
  ) {
    super(message);
    this.name = 'HostClientOptionsError';
  }
}

export const hostSandboxOptionsSchema = z.object({
  enabled: z.boolean().optional(),
  network: z.enum(['allow', 'deny']).optional(),
  prefer: z
    .enum(['auto', 'docker', 'podman', 'seatbelt', 'bubblewrap'])
    .optional(),
});
export type HostSandboxOptions = z.infer<typeof hostSandboxOptionsSchema> & {
  prefer?: SandboxBackendPrefer | undefined;
};

/** Scalar subset of the options validated with Zod at the public entry. */
export const hostClientScalarOptionsSchema = z.object({
  workspaceId: z.string().trim().min(1),
  defaultMode: z.enum(['ask', 'plan', 'agent']).optional(),
  defaultSessionId: z.string().min(1).optional(),
  taskListAutoAdvance: z.boolean().optional(),
  sandbox: hostSandboxOptionsSchema.optional(),
});

type ToolPorts = ConstructorParameters<typeof ToolRuntimePipeline>[0];

/** Snapshot subset the factory needs from an MCP manager sync. */
export interface HostMcpSnapshot {
  toolDefinitions: readonly ModelToolDefinition[];
}

/** MCP wiring: connect once, then expose tools + registry to the tool runtime. */
export interface HostMcpPort {
  sync(): Promise<HostMcpSnapshot>;
  createRegistry(): NonNullable<
    ConstructorParameters<typeof ToolRuntimePipeline>[1]
  >['registry'];
}

export interface HostMemoryOptions {
  /** Defaults to the durable workspace memory store. */
  store?: MemoryStorePort;
  /** Used to resolve the memory embedding port. */
  semanticIndex?: SemanticIndexSettings;
}

export interface HostRepositoryContextDeps {
  repositoryState: RepositoryStatePipeline;
  workspaceRoot: string;
  git: GitPort;
}

export interface CreateHostClientOptions {
  /** `undefined` yields a chat-only client (no tools/verification/graphs). */
  workspaceRoot: string | undefined;
  workspaceId: string;
  llm: { understandingLlm: LlmPort; runLlm: LlmPort };
  env?: NodeJS.ProcessEnv;
  defaultMode?: AgentMode;
  defaultSessionId?: string;
  taskListAutoAdvance?: boolean;

  /** OS sandbox for the default process port. Ignored when `processPort` is set. */
  sandbox?: HostSandboxOptions;
  /** Host-provided process port (e.g. a live-settings sandbox wrapper). */
  processPort?: ToolPorts['process'];
  network?: ToolPorts['network'];
  /** Search credentials; the port is omitted when none resolve. */
  search?: { apiKey?: string; searxngBaseUrl?: string };
  diagnostics?: ToolPorts['diagnostics'];
  codeNavigation?: ToolPorts['codeNavigation'];
  /** Forwarded to the tool runtime (`apply_patch` fuzzy matching default). */
  fuzzyMatchDefault?: boolean;

  mcp?: HostMcpPort;
  /** Replace the default disk skills catalog, or disable workspace skills. */
  skills?: { catalog?: SkillsCatalogPort; workspaceSkills?: boolean };
  /** Present = memory on (defaults to the durable workspace store). */
  memory?: HostMemoryOptions;
  /** Build the host repository context from factory-owned deps. */
  repositoryContext?: (
    deps: HostRepositoryContextDeps,
  ) => CreateMitiiClientOptions['repositoryContext'];
  /** Last-writer-wins overrides applied to `createMitiiClient`. */
  clientOptions?: Partial<CreateMitiiClientOptions>;
}

export interface HostClientComposition {
  client: MitiiClient;
  repositoryState: RepositoryStatePipeline;
  tools?: ToolRuntimePipeline;
  verification?: VerificationPipeline;
  git?: GitPort;
  mcpToolDefinitions: readonly ModelToolDefinition[];
  memoryStore?: MemoryStorePort;
  memoryEmbedding?: CreateMitiiClientOptions['memoryEmbedding'];
}
