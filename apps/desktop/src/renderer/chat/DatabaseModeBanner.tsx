export type DatabaseModeBannerStatus =
  | 'connected'
  | 'disconnected'
  | 'mcp_disabled'
  | 'loading';

export interface DatabaseModeServerRef {
  id: string;
  name: string;
}

interface DatabaseModeBannerProps {
  visible: boolean;
  status: DatabaseModeBannerStatus;
  /** Connected database MCP servers (enabled). */
  servers?: readonly DatabaseModeServerRef[];
  /** Composer DB access tier. */
  dbAccess?: 'readonly' | 'readwrite';
  onOpenMcp?: () => void;
}

const DATABASE_BUILTIN_IDS = new Set(['sqlite', 'postgres', 'mongo']);

/** Match host `listInstalledDatabaseMcpServers` classification for UI. */
export function isDatabaseMcpServer(server: {
  id: string;
  name: string;
}): boolean {
  const id = server.id.trim().toLowerCase();
  if (DATABASE_BUILTIN_IDS.has(id)) return true;
  const hay = `${id} ${server.name}`.toLowerCase();
  return (
    /\b(sqlite|postgres|postgresql|mysql|mariadb|mssql|sqlserver|mongo|mongodb|neon|supabase|duckdb|redshift|snowflake|bigquery|odbc|database|db-)\b/.test(
      hay,
    ) ||
    hay.includes('sql') ||
    hay.endsWith('-db') ||
    hay.startsWith('db-')
  );
}

function shortServerLabel(name: string, id: string): string {
  const raw = (name || id).trim();
  return raw.replace(/\s*\(read-only\)\s*$/i, '').trim() || id;
}

/**
 * Subtle status strip above the composer in Database mode.
 * Shows live MCP connection state — not a permanent install CTA.
 */
export function DatabaseModeBanner({
  visible,
  status,
  servers = [],
  dbAccess = 'readonly',
  onOpenMcp,
}: DatabaseModeBannerProps) {
  if (!visible) return null;

  const primary = servers[0];
  const extra = Math.max(0, servers.length - 1);
  const serverLabel = primary
    ? shortServerLabel(primary.name, primary.id) +
      (extra > 0 ? ` +${extra}` : '')
    : null;
  const accessLabel = dbAccess === 'readwrite' ? 'Read & write' : 'Read-only';

  let tone: 'ok' | 'warn' | 'muted' = 'muted';
  let title = 'Database';
  let detail = 'Checking connection…';
  let actionLabel: string | null = 'MCP';

  if (status === 'connected' && serverLabel) {
    tone = dbAccess === 'readwrite' ? 'warn' : 'ok';
    title = 'Connected';
    detail = `${serverLabel} · ${accessLabel}`;
    actionLabel = 'Manage';
  } else if (status === 'mcp_disabled') {
    tone = 'warn';
    title = 'MCP off';
    detail = 'Enable MCP, then install a database server (SQLite, Postgres, or MongoDB).';
    actionLabel = 'Open MCP';
  } else if (status === 'disconnected') {
    tone = 'warn';
    title = 'Not connected';
    detail = 'Install SQLite, Postgres, or MongoDB.';
    actionLabel = 'Open MCP';
  } else if (status === 'connected' && !serverLabel) {
    tone = 'warn';
    title = 'Not connected';
    detail = 'Install SQLite, Postgres, or MongoDB.';
    actionLabel = 'Open MCP';
  }

  return (
    <div
      className={`database-mode-banner database-mode-banner--${tone}`}
      role="status"
      aria-live="polite"
    >
      <div className="database-mode-banner__main">
        <span
          className={`database-mode-banner__dot database-mode-banner__dot--${tone}`}
          aria-hidden="true"
        />
        <div className="database-mode-banner__copy">
          <span className="database-mode-banner__title">{title}</span>
          <span className="database-mode-banner__sep" aria-hidden="true">
            ·
          </span>
          <span className="database-mode-banner__detail">{detail}</span>
        </div>
      </div>
      {onOpenMcp && actionLabel ? (
        <button
          type="button"
          className="database-mode-banner__action"
          onClick={onOpenMcp}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
