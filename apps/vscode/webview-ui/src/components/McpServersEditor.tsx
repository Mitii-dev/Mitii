import { useEffect, useState } from 'react';

import type { McpServerConfig, McpSettings, McpTransport } from '../protocol';

interface McpServersEditorProps {
  mcp: McpSettings;
  runtimeStatus?: string;
  onChange: (next: McpSettings) => void;
  onSave: (next: McpSettings) => void;
}

export function McpServersEditor({
  mcp,
  runtimeStatus,
  onChange,
  onSave,
}: McpServersEditorProps) {
  const [draft, setDraft] = useState(mcp);

  useEffect(() => {
    setDraft(mcp);
  }, [mcp]);

  const update = (next: McpSettings) => {
    setDraft(next);
    onChange(next);
  };

  const updateServer = (idx: number, patch: Partial<McpServerConfig>) => {
    const servers = draft.servers.slice();
    servers[idx] = { ...servers[idx]!, ...patch };
    update({ ...draft, servers });
  };

  return (
    <div className="mcp-servers-editor">
      {runtimeStatus ? (
        <p className="field-hint">Runtime: {runtimeStatus}</p>
      ) : null}
      <label className="toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => update({ ...draft, enabled: e.target.checked })}
        />
        Enable MCP servers
      </label>
      {draft.servers.map((server, idx) => (
        <div key={`${server.name}-${idx}`} className="mcp-server">
          <div className="field">
            <label>Name</label>
            <input
              value={server.name}
              onChange={(e) => updateServer(idx, { name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Transport</label>
            <select
              value={server.transport}
              onChange={(e) =>
                updateServer(idx, {
                  transport: e.target.value as McpTransport,
                })
              }
            >
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
              <option value="streamable-http">streamable-http</option>
            </select>
          </div>
          {server.transport === 'stdio' ? (
            <div className="field">
              <label>Command</label>
              <input
                value={server.command ?? ''}
                onChange={(e) => updateServer(idx, { command: e.target.value })}
              />
            </div>
          ) : (
            <div className="field">
              <label>URL</label>
              <input
                value={server.url ?? ''}
                onChange={(e) => updateServer(idx, { url: e.target.value })}
              />
            </div>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={Boolean(server.disabled)}
              onChange={(e) => updateServer(idx, { disabled: e.target.checked })}
            />
            Disabled
          </label>
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              update({
                ...draft,
                servers: draft.servers.filter((_, i) => i !== idx),
              })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            update({
              ...draft,
              servers: [
                ...draft.servers,
                {
                  name: `server-${draft.servers.length + 1}`,
                  transport: 'stdio',
                  command: '',
                },
              ],
            })
          }
        >
          Add server
        </button>
        <button type="button" className="btn" onClick={() => onSave(draft)}>
          Save MCP
        </button>
      </div>
    </div>
  );
}
