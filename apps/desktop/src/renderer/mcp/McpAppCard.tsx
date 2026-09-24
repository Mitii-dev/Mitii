import type { DesktopActivityItem } from '../../shared/activity.js';

export interface McpAppViewPayload {
  serverId: string;
  tool: string;
  title: string;
  checkpointId?: string;
  svgDataUrl?: string;
  html?: string;
  paths: {
    md?: string;
    docsMd?: string;
    excalidraw?: string;
    svg?: string;
  };
}

interface McpAppCardProps {
  app: McpAppViewPayload;
  onOpenPath?: (path: string) => void;
}

/** Chat card for Excalidraw / MCP Apps diagrams with SVG preview. */
export function McpAppCard({ app, onOpenPath }: McpAppCardProps) {
  const paths = [
    app.paths.md ? { label: 'Open MD', path: app.paths.md } : null,
    app.paths.docsMd ? { label: 'Open docs MD', path: app.paths.docsMd } : null,
    app.paths.excalidraw
      ? { label: 'Open .excalidraw', path: app.paths.excalidraw }
      : null,
    app.paths.svg ? { label: 'Open SVG', path: app.paths.svg } : null,
  ].filter(Boolean) as Array<{ label: string; path: string }>;

  return (
    <div className="mcp-app-card">
      <div className="mcp-app-card__header">
        <strong>{app.title}</strong>
        {app.checkpointId ? (
          <span className="mcp-app-card__meta">checkpoint {app.checkpointId}</span>
        ) : null}
      </div>
      {app.svgDataUrl ? (
        <img
          className="mcp-app-card__svg"
          src={app.svgDataUrl}
          alt={app.title}
        />
      ) : null}
      {app.html ? (
        <details className="mcp-app-card__fallback">
          <summary>Interactive MCP App (experimental)</summary>
          <iframe
            className="mcp-app-card__frame"
            title={app.title}
            sandbox="allow-scripts allow-same-origin allow-forms"
            srcDoc={app.html}
          />
        </details>
      ) : null}
      {paths.length > 0 ? (
        <div className="mcp-app-card__actions">
          {paths.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="btn ghost"
              onClick={() => onOpenPath?.(entry.path)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function mcpAppsFromActivity(
  items: DesktopActivityItem[] | undefined,
): McpAppViewPayload[] {
  if (!items?.length) return [];
  const out: McpAppViewPayload[] = [];
  for (const item of items) {
    if (item.kind === 'mcp_app' && item.mcpApp) {
      out.push(item.mcpApp);
    }
  }
  return out;
}
