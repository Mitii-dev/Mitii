import type { McpServerConfig } from '../contracts/types.js';

/**
 * Built-in MCP server catalog (store).
 * Not installed by default — hosts add entries into `McpSettings.servers`
 * when the user opts in.
 */
export const MCP_BUILTIN_IDS = [
  'filesystem',
  'sequential-thinking',
  'memory',
  'playwright',
  'puppeteer',
  'github',
  'gitea',
  'brave-search',
  'excalidraw',
] as const;

export type McpBuiltinId = (typeof MCP_BUILTIN_IDS)[number];

export type McpCatalogCategory =
  | 'workspace'
  | 'reasoning'
  | 'browser'
  | 'vcs'
  | 'search'
  | 'diagrams';

/** Secret / config field collected before one-click install. */
export interface McpCatalogSecretField {
  /** Env var written into `.mitii/mcp.json` `env`. */
  key: string;
  label: string;
  /** Mask input in the UI. */
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

export interface McpCatalogMeta {
  id: McpBuiltinId;
  category: McpCatalogCategory;
  description: string;
  secrets: readonly McpCatalogSecretField[];
}

export const MCP_CATALOG_META: Record<McpBuiltinId, McpCatalogMeta> = {
  filesystem: {
    id: 'filesystem',
    category: 'workspace',
    description: 'Bounded filesystem tools for this workspace.',
    secrets: [],
  },
  'sequential-thinking': {
    id: 'sequential-thinking',
    category: 'reasoning',
    description: 'Structured multi-step reasoning helper.',
    secrets: [],
  },
  memory: {
    id: 'memory',
    category: 'reasoning',
    description: 'External memory tools via MCP.',
    secrets: [],
  },
  playwright: {
    id: 'playwright',
    category: 'browser',
    description: 'Browser automation via Playwright (accessibility snapshots).',
    secrets: [],
  },
  puppeteer: {
    id: 'puppeteer',
    category: 'browser',
    description: 'Browser automation via Puppeteer.',
    secrets: [],
  },
  github: {
    id: 'github',
    category: 'vcs',
    description: 'GitHub repos, issues, PRs, and code search.',
    secrets: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub personal access token',
        secret: true,
        required: true,
        placeholder: 'ghp_…',
        hint: 'Classic or fine-grained PAT with repo access as needed.',
      },
    ],
  },
  gitea: {
    id: 'gitea',
    category: 'vcs',
    description: 'Self-hosted Gitea repos, issues, and pull requests.',
    secrets: [
      {
        key: 'GITEA_HOST',
        label: 'Gitea host URL',
        secret: false,
        required: true,
        placeholder: 'https://gitea.example.com',
        hint: 'Base URL of your Gitea instance (no trailing slash required).',
      },
      {
        key: 'GITEA_ACCESS_TOKEN',
        label: 'Gitea access token',
        secret: true,
        required: true,
        placeholder: 'token',
        hint: 'Create under Settings → Applications on your Gitea instance.',
      },
    ],
  },
  'brave-search': {
    id: 'brave-search',
    category: 'search',
    description: 'Web and local search via Brave Search API.',
    secrets: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave Search API key',
        secret: true,
        required: true,
        placeholder: 'BSA…',
        hint: 'From https://brave.com/search/api/',
      },
    ],
  },
  excalidraw: {
    id: 'excalidraw',
    category: 'diagrams',
    description: 'Hand-drawn architecture diagrams (mcp.excalidraw.com).',
    secrets: [],
  },
};

export function getBuiltinCatalogMeta(id: McpBuiltinId): McpCatalogMeta {
  return MCP_CATALOG_META[id];
}

/** Catalog entries for the MCP store UI (never auto-merged into settings). */
export function createBuiltinMcpCatalog(
  workspaceRoot?: string,
): McpServerConfig[] {
  const fsArgs = workspaceRoot
    ? ['-y', '@modelcontextprotocol/server-filesystem', workspaceRoot]
    : ['-y', '@modelcontextprotocol/server-filesystem', '.'];

  return [
    {
      id: 'filesystem',
      name: 'Filesystem',
      transport: 'stdio',
      command: 'npx',
      args: fsArgs,
      builtin: true,
      enabled: false,
    },
    {
      id: 'sequential-thinking',
      name: 'Sequential Thinking',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'memory',
      name: 'Memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'playwright',
      name: 'Playwright',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'puppeteer',
      name: 'Puppeteer',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'github',
      name: 'GitHub',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'gitea',
      name: 'Gitea',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'gitea-mcp'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'brave-search',
      name: 'Brave Search',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'excalidraw',
      name: 'Excalidraw',
      transport: 'streamable-http',
      url: 'https://mcp.excalidraw.com',
      builtin: true,
      enabled: false,
    },
  ];
}

/** @deprecated Use createBuiltinMcpCatalog — name kept for older imports. */
export const createBuiltinMcpServers = createBuiltinMcpCatalog;

export function isMcpBuiltinId(id: string | undefined): id is McpBuiltinId {
  return (
    typeof id === 'string' &&
    (MCP_BUILTIN_IDS as readonly string[]).includes(id)
  );
}

export function getBuiltinCatalogEntry(
  id: McpBuiltinId,
  workspaceRoot?: string,
): McpServerConfig {
  const entry = createBuiltinMcpCatalog(workspaceRoot).find((s) => s.id === id);
  if (!entry) {
    throw new Error(`Unknown MCP builtin: ${id}`);
  }
  return entry;
}

/** Merge user-provided secrets into a catalog entry before writing mcp.json. */
export function applyBuiltinSecrets(
  entry: McpServerConfig,
  secrets: Record<string, string> | undefined,
): McpServerConfig {
  if (!secrets || Object.keys(secrets).length === 0) return entry;
  const env = { ...(entry.env ?? {}) };
  for (const [key, value] of Object.entries(secrets)) {
    const trimmed = value.trim();
    if (trimmed) env[key] = trimmed;
  }
  return { ...entry, env };
}

export function validateBuiltinSecrets(
  id: McpBuiltinId,
  secrets: Record<string, string> | undefined,
): string | null {
  const meta = getBuiltinCatalogMeta(id);
  for (const field of meta.secrets) {
    if (!field.required) continue;
    const value = secrets?.[field.key]?.trim() ?? '';
    if (!value) return `${field.label} is required`;
  }
  return null;
}
