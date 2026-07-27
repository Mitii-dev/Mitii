import { useEffect, useMemo, useState } from 'react';

import type { McpServerConfig, McpSettings, McpTransport } from '../protocol';

interface McpServersEditorProps {
  mcp: McpSettings;
  /** Built-in catalog available to install (store). */
  storeCatalog?: McpServerConfig[];
  runtimeStatus?: string;
  onChange: (next: McpSettings) => void;
  onSave: (next: McpSettings) => void;
}

function isEnabled(server: McpServerConfig): boolean {
  if (typeof server.enabled === 'boolean') return server.enabled;
  return !server.disabled;
}

function serverKey(server: McpServerConfig, idx?: number): string {
  return server.id ?? `${server.name}-${idx ?? 0}`;
}

export function McpServersEditor({
  mcp,
  storeCatalog = [],
  runtimeStatus,
  onChange,
  onSave,
}: McpServersEditorProps) {
  const [draft, setDraft] = useState(mcp);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setDraft(mcp);
  }, [mcp]);

  const update = (next: McpSettings) => {
    setDraft(next);
    onChange(next);
  };

  const updateServer = (idx: number, patch: Partial<McpServerConfig>) => {
    const servers = draft.servers.slice();
    const current = servers[idx]!;
    const next = { ...current, ...patch };
    if (typeof patch.enabled === 'boolean') {
      next.disabled = !patch.enabled;
    }
    servers[idx] = next;
    update({ ...draft, servers });
  };

  const removeServer = (idx: number) => {
    update({
      ...draft,
      servers: draft.servers.filter((_, i) => i !== idx),
    });
  };

  const installedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of draft.servers) {
      if (s.id) ids.add(s.id);
      ids.add(s.name.toLowerCase());
    }
    return ids;
  }, [draft.servers]);

  const availableFromStore = useMemo(
    () =>
      storeCatalog.filter((entry) => {
        const id = entry.id ?? entry.name.toLowerCase();
        return !installedIds.has(id) && !installedIds.has(entry.name.toLowerCase());
      }),
    [storeCatalog, installedIds],
  );

  const installFromStore = (entry: McpServerConfig) => {
    update({
      ...draft,
      servers: [
        ...draft.servers,
        {
          ...entry,
          enabled: true,
          disabled: false,
        },
      ],
    });
  };

  const statusHint =
    runtimeStatus === 'ready'
      ? ' — connected; tools available in Agent mode.'
      : runtimeStatus === 'partial'
        ? ' — some servers connected, others failed.'
        : runtimeStatus === 'error'
          ? ' — servers failed to start (check command / network for npx).'
          : runtimeStatus === 'configured'
            ? ' — installed but not connected yet (turn on MCP and save).'
            : runtimeStatus === 'disabled'
              ? ' — master switch is off; nothing is spawned.'
              : '';

  return (
    <div className="mcp-servers-editor">
      {runtimeStatus ? (
        <p className="field-hint">
          Runtime: {runtimeStatus}
          {statusHint}
        </p>
      ) : null}

      <label className="toggle mcp-master-toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => update({ ...draft, enabled: e.target.checked })}
        />
        Enable MCP
      </label>
      <p className="field-hint">
        Off by default. Install servers from the store, enable the ones you
        want, or remove them anytime. Custom stdio servers work the same way.
      </p>

      <h3 className="mcp-section-title">Installed</h3>
      {draft.servers.length === 0 ? (
        <p className="field-hint">No servers installed yet.</p>
      ) : (
        <ul className="mcp-server-list">
          {draft.servers.map((server, idx) => {
            const key = serverKey(server, idx);
            const open = Boolean(expanded[key]);
            const on = isEnabled(server);
            return (
              <li key={key} className={`mcp-server-row${on ? '' : ' is-off'}`}>
                <div className="mcp-server-row__main">
                  <label className="toggle mcp-server-row__toggle">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!draft.enabled}
                      onChange={(e) =>
                        updateServer(idx, { enabled: e.target.checked })
                      }
                    />
                    <span className="mcp-server-row__name">
                      {server.name}
                      {server.builtin ? (
                        <span className="mcp-server-row__badge">store</span>
                      ) : (
                        <span className="mcp-server-row__badge">custom</span>
                      )}
                    </span>
                  </label>
                  <div className="mcp-server-row__actions">
                    <button
                      type="button"
                      className="btn ghost mcp-server-row__details"
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [key]: !open }))
                      }
                    >
                      {open ? 'Hide' : 'Details'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => removeServer(idx)}
                      title="Remove from install list"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {open ? (
                  <div className="mcp-server">
                    <div className="field">
                      <label>Name</label>
                      <input
                        value={server.name}
                        disabled={Boolean(server.builtin)}
                        onChange={(e) =>
                          updateServer(idx, { name: e.target.value })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>Transport</label>
                      <select
                        value={server.transport}
                        disabled={Boolean(server.builtin)}
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
                      <>
                        <div className="field">
                          <label>Command</label>
                          <input
                            value={server.command ?? ''}
                            disabled={Boolean(server.builtin)}
                            onChange={(e) =>
                              updateServer(idx, { command: e.target.value })
                            }
                          />
                        </div>
                        <div className="field">
                          <label>Args (space-separated)</label>
                          <input
                            value={(server.args ?? []).join(' ')}
                            disabled={Boolean(server.builtin)}
                            onChange={(e) =>
                              updateServer(idx, {
                                args: e.target.value
                                  .split(/\s+/)
                                  .filter(Boolean),
                              })
                            }
                          />
                        </div>
                      </>
                    ) : (
                      <div className="field">
                        <label>URL</label>
                        <input
                          value={server.url ?? ''}
                          onChange={(e) =>
                            updateServer(idx, { url: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {availableFromStore.length > 0 ? (
        <>
          <h3 className="mcp-section-title">Store</h3>
          <p className="field-hint">
            Built-in servers you can install. Delete later to return them here.
          </p>
          <ul className="mcp-server-list">
            {availableFromStore.map((entry) => {
              const key = serverKey(entry);
              return (
                <li key={key} className="mcp-server-row">
                  <div className="mcp-server-row__main">
                    <span className="mcp-server-row__name">
                      {entry.name}
                      <span className="mcp-server-row__badge">available</span>
                    </span>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => installFromStore(entry)}
                    >
                      Add
                    </button>
                  </div>
                  {entry.command ? (
                    <p className="field-hint mono">
                      {entry.command} {(entry.args ?? []).join(' ')}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

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
                  id: `custom-${Date.now().toString(36)}`,
                  name: `custom-server`,
                  transport: 'stdio',
                  command: 'npx',
                  args: [],
                  builtin: false,
                  enabled: true,
                  disabled: false,
                },
              ],
            })
          }
        >
          Add custom
        </button>
        <button type="button" className="btn" onClick={() => onSave(draft)}>
          Save MCP
        </button>
      </div>
    </div>
  );
}
