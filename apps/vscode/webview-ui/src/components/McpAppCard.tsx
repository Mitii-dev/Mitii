import type { McpAppViewPayload } from '../protocol';

interface McpAppCardProps {
  app: McpAppViewPayload;
  onOpenPath?: (path: string) => void;
}

/**
 * Chat card for Excalidraw / MCP Apps diagrams:
 * - SVG preview (always, when available)
 * - optional experimental iframe when HTML resource was fetched
 * - links to saved MD / .excalidraw / .svg artifacts
 */
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
