interface DatabaseModeBannerProps {
  visible: boolean;
}

export function DatabaseModeBanner({ visible }: DatabaseModeBannerProps) {
  if (!visible) return null;

  return (
    <div className="database-mode-banner" role="status">
      <div className="database-mode-banner__text">
        <strong>Database mode.</strong> Enable MCP and install a read-only DB
        server (SQLite / Postgres / MongoDB). Read-only probes only — no code
        edits.
      </div>
    </div>
  );
}
