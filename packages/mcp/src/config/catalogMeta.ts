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
  'sqlite',
  'postgres',
  'mongo',
  'sql',
] as const;

export type McpBuiltinId = (typeof MCP_BUILTIN_IDS)[number];

export type McpCatalogCategory =
  | 'workspace'
  | 'reasoning'
  | 'browser'
  | 'vcs'
  | 'search'
  | 'diagrams'
  | 'database';

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
  sqlite: {
    id: 'sqlite',
    category: 'database',
    description:
      'SQLite via @mitii/mcp-sqlite. Read-only or read/write (MCP_DB_ACCESS). Tools: list_tables, describe_table, query, execute_write.',
    secrets: [
      {
        key: 'SQLITE_PATH',
        label: 'SQLite database path',
        secret: false,
        required: true,
        placeholder: './data/app.db',
        hint: 'Absolute or workspace-relative path to the .db / .sqlite file.',
      },
    ],
  },
  postgres: {
    id: 'postgres',
    category: 'database',
    description:
      'Postgres via @mitii/mcp-postgres. Read-only or read/write (MCP_DB_ACCESS). Tools: list_tables, describe_table, query, execute_write.',
    secrets: [
      {
        key: 'MITII_DB_HOST',
        label: 'Host',
        secret: false,
        required: true,
        placeholder: 'localhost',
        hint: 'Hostname or IP of the Postgres server.',
      },
      {
        key: 'MITII_DB_PORT',
        label: 'Port',
        secret: false,
        required: false,
        placeholder: '5432',
      },
      {
        key: 'MITII_DB_USER',
        label: 'Username',
        secret: false,
        required: false,
        placeholder: 'postgres',
      },
      {
        key: 'MITII_DB_PASSWORD',
        label: 'Password',
        secret: true,
        required: false,
        placeholder: '••••••••',
      },
      {
        key: 'MITII_DB_NAME',
        label: 'Database',
        secret: false,
        required: true,
        placeholder: 'mydb',
      },
      {
        key: 'DATABASE_URI',
        label: 'Full connection URI',
        secret: true,
        required: false,
        placeholder: 'postgresql://user:pass@localhost:5432/mydb',
        hint: 'Optional. When set, overrides host/user/password/database above (prefer a least-privilege role).',
      },
    ],
  },
  mongo: {
    id: 'mongo',
    category: 'database',
    description:
      'MongoDB via @mitii/mcp-mongo. Read-only or read/write (MCP_DB_ACCESS). Tools: list/describe/query/aggregate/count + insert/update/delete/create_index.',
    secrets: [
      {
        key: 'MITII_DB_HOST',
        label: 'Host',
        secret: false,
        required: true,
        placeholder: 'localhost',
        hint: 'Hostname or IP (or Atlas cluster host).',
      },
      {
        key: 'MITII_DB_PORT',
        label: 'Port',
        secret: false,
        required: false,
        placeholder: '27017',
      },
      {
        key: 'MITII_DB_USER',
        label: 'Username',
        secret: false,
        required: false,
        placeholder: 'appUser',
      },
      {
        key: 'MITII_DB_PASSWORD',
        label: 'Password',
        secret: true,
        required: false,
        placeholder: '••••••••',
      },
      {
        key: 'MITII_DB_NAME',
        label: 'Database',
        secret: false,
        required: true,
        placeholder: 'mydb',
      },
      {
        key: 'MCP_MONGODB_URI',
        label: 'Full connection URI',
        secret: true,
        required: false,
        placeholder: 'mongodb://user:pass@localhost:27017/mydb',
        hint: 'Optional. When set, overrides fields above. Use for mongodb+srv:// Atlas URIs.',
      },
    ],
  },
  sql: {
    id: 'sql',
    category: 'database',
    description:
      'Multi-dialect SQL via @mitii/mcp-sql (Postgres/MySQL/MariaDB/SQLite). Tools: list/describe/sample/query/explain + execute_write. Access via MCP_DB_ACCESS.',
    secrets: [
      {
        key: 'SQL_MCP_DIALECT',
        label: 'Dialect',
        secret: false,
        required: true,
        placeholder: 'postgresql',
        hint: 'postgresql, mysql, mariadb, or sqlite.',
      },
      {
        key: 'MITII_DB_HOST',
        label: 'Host',
        secret: false,
        required: false,
        placeholder: 'localhost',
        hint: 'Required for network dialects (not sqlite).',
      },
      {
        key: 'MITII_DB_PORT',
        label: 'Port',
        secret: false,
        required: false,
        placeholder: '5432',
        hint: 'Defaults: 5432 (postgres), 3306 (mysql/mariadb).',
      },
      {
        key: 'MITII_DB_USER',
        label: 'Username',
        secret: false,
        required: false,
        placeholder: 'user',
      },
      {
        key: 'MITII_DB_PASSWORD',
        label: 'Password',
        secret: true,
        required: false,
        placeholder: '••••••••',
      },
      {
        key: 'MITII_DB_NAME',
        label: 'Database',
        secret: false,
        required: false,
        placeholder: 'mydb',
        hint: 'Required for network dialects.',
      },
      {
        key: 'MITII_DB_PATH',
        label: 'SQLite path',
        secret: false,
        required: false,
        placeholder: './data/app.db',
        hint: 'Required when dialect is sqlite (absolute or workspace-relative .db path).',
      },
      {
        key: 'SQL_MCP_URI',
        label: 'Full connection URI',
        secret: true,
        required: false,
        placeholder: 'postgresql://user:pass@localhost:5432/mydb',
        hint: 'Optional. When set, overrides structured fields (URI or .db path).',
      },
    ],
  },
};
