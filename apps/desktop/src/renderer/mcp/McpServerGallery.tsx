/**
 * Installed MCP servers as toggle/delete tiles.
 */

import { IconTrash } from '../shell/ActivityIcons.js';
import type { McpServerRow } from './mcpManagerTypes.js';

interface Props {
  servers: McpServerRow[];
  filteredServers: McpServerRow[];
  busy: boolean;
  onToggle: (serverId: string, next: boolean) => void | Promise<void>;
  onRemove: (serverId: string) => void | Promise<void>;
  onAdd: () => void;
}

export function McpServerGallery(props: Props) {
  const { servers, filteredServers, busy } = props;
  return (
    <section className="mcp-manager__section">
      <div className="mcp-manager__section-head">
        <h3>Installed</h3>
        <span>{filteredServers.length}</span>
      </div>
      {filteredServers.length === 0 && servers.length > 0 ? (
        <p className="workspace-empty">
          No installed servers match your search.
        </p>
      ) : (
        <div className="profile-gallery mcp-manager__gallery">
          {filteredServers.map((server) => {
            const initial = (server.name.trim()[0] || '?').toUpperCase();
            return (
              <div
                key={server.id}
                className={`profile-tile${server.enabled ? ' is-active' : ''}`}
              >
                <label
                  className="profile-tile__check"
                  onClick={(e) => e.stopPropagation()}
                  title={server.enabled ? 'Disable' : 'Enable'}
                >
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    disabled={busy}
                    aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
                    onChange={(e) =>
                      void props.onToggle(server.id, e.target.checked)
                    }
                  />
                </label>
                <div className="profile-tile__body profile-tile__body--static">
                  <span className="profile-tile__avatar" aria-hidden>
                    {initial}
                  </span>
                  <span className="profile-tile__name">{server.name}</span>
                  <span className="profile-tile__meta">
                    {server.id}
                    {server.transport ? ` · ${server.transport}` : ''}
                    {server.builtin ? ' · builtin' : ' · custom'}
                  </span>
                  {server.enabled ? (
                    <span className="profile-tile__badge">On</span>
                  ) : (
                    <span className="profile-tile__badge profile-tile__badge--edit">
                      Off
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="mcp-manager__tile-delete"
                  title={`Delete ${server.id}`}
                  aria-label={`Delete ${server.id}`}
                  disabled={busy}
                  onClick={() => void props.onRemove(server.id)}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="profile-tile profile-tile--add"
            disabled={busy}
            onClick={props.onAdd}
          >
            <span className="profile-tile__avatar" aria-hidden>
              +
            </span>
            <span className="profile-tile__name">Add MCP</span>
            <span className="profile-tile__meta">
              Catalog or custom server
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
