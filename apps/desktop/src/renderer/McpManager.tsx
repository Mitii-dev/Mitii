/**
 * Full-screen Code-mode MCP manager: search, install catalog, create custom, delete.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
} from './ActivityIcons.js';
import {
  addCustomMcp,
  deleteMcpServer,
  fetchMcpServers,
  installBuiltinMcp,
  setMcpEnabled,
} from './api.js';

type Transport = 'stdio' | 'sse' | 'streamable-http';
type WizardStep = 'source' | 'catalog' | 'custom-transport' | 'custom-details';

interface McpServerRow {
  id: string;
  name: string;
  enabled: boolean;
  transport?: string;
  builtin?: boolean;
}

interface CatalogRow {
  id: string;
  name: string;
  transport: string;
  description: string;
  installed: boolean;
}

interface Props {
  baseUrl: string;
  token?: string;
  onRestartEngine?: () => Promise<void>;
}

const EMPTY_CUSTOM = {
  id: '',
  name: '',
  transport: 'stdio' as Transport,
  command: 'npx',
  argsText: '',
  cwd: '',
  url: '',
  headersText: '',
};

export function McpManager(props: Props) {
  const auth = { baseUrl: props.baseUrl, token: props.token };
  const [enabled, setEnabled] = useState(false);
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>('source');
  const [custom, setCustom] = useState(EMPTY_CUSTOM);
  const [selectedBuiltin, setSelectedBuiltin] = useState<string | null>(null);

  const applySnapshot = (next: {
    enabled: boolean;
    servers: McpServerRow[];
    catalog?: CatalogRow[];
  }) => {
    setEnabled(next.enabled);
    setServers(next.servers);
    if (next.catalog) setCatalog(next.catalog);
  };

  const reload = useCallback(async () => {
    try {
      const next = await fetchMcpServers(auth);
      applySnapshot(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.baseUrl, props.token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = (message: string) => {
    setNote(message);
    window.setTimeout(() => setNote(null), 1800);
  };

  const afterMutation = async (
    next: {
      enabled: boolean;
      servers: McpServerRow[];
      catalog?: CatalogRow[];
      restartRequired?: boolean;
    },
    message: string,
  ) => {
    applySnapshot(next);
    if (next.restartRequired && props.onRestartEngine) {
      await props.onRestartEngine();
      flash(`${message} — engine restarted`);
    } else {
      flash(message);
    }
    await reload();
  };

  const q = query.trim().toLowerCase();
  const filteredServers = useMemo(() => {
    if (!q) return servers;
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.transport ?? '').toLowerCase().includes(q),
    );
  }, [servers, q]);

  const availableCatalog = useMemo(() => {
    const list = catalog.filter((c) => !c.installed);
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [catalog, q]);

  const openWizard = () => {
    setWizardOpen(true);
    setWizardStep('source');
    setSelectedBuiltin(null);
    setCustom({
      ...EMPTY_CUSTOM,
      id: `mcp-${Date.now().toString(36)}`,
      name: 'My MCP server',
    });
    setError(null);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setWizardStep('source');
    setSelectedBuiltin(null);
  };

  const toggleMaster = async (next: boolean) => {
    setBusy(true);
    try {
      const result = await setMcpEnabled({ ...auth, enabled: next });
      await afterMutation(result, next ? 'MCP enabled' : 'MCP disabled');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleServer = async (serverId: string, next: boolean) => {
    setBusy(true);
    try {
      const result = await setMcpEnabled({
        ...auth,
        serverId,
        enabled: next,
      });
      await afterMutation(result, next ? `${serverId} on` : `${serverId} off`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeServer = async (serverId: string) => {
    if (
      !window.confirm(
        `Remove MCP server “${serverId}” from this workspace?\n\nThis updates .mitii/mcp.json. Built-in servers can be re-added from the catalog.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await deleteMcpServer({ ...auth, serverId });
      await afterMutation(result, `Removed ${serverId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const installSelectedBuiltin = async () => {
    if (!selectedBuiltin) return;
    setBusy(true);
    try {
      const result = await installBuiltinMcp({
        ...auth,
        builtinId: selectedBuiltin,
      });
      await afterMutation(result, `Installed ${selectedBuiltin}`);
      closeWizard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createCustom = async () => {
    setBusy(true);
    try {
      let headers: Record<string, string> | undefined;
      if (custom.headersText.trim()) {
        headers = {};
        for (const line of custom.headersText.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const idx = trimmed.indexOf(':');
          if (idx <= 0) throw new Error('Headers must be Name: value per line');
          headers[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
        }
      }
      const args = custom.argsText
        .split(/\s+/)
        .map((v) => v.trim())
        .filter(Boolean);
      const result = await addCustomMcp({
        ...auth,
        id: custom.id,
        name: custom.name,
        transport: custom.transport,
        ...(custom.transport === 'stdio'
          ? {
              command: custom.command,
              ...(args.length ? { args } : {}),
              ...(custom.cwd.trim() ? { cwd: custom.cwd.trim() } : {}),
            }
          : {
              url: custom.url,
              ...(headers ? { headers } : {}),
            }),
        enabled: true,
      });
      await afterMutation(result, `Added ${custom.id || custom.name}`);
      closeWizard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mcp-manager">
      <header className="mcp-manager__header">
        <div className="mcp-manager__title-block">
          <h2>MCP</h2>
          <p>
            Install and manage Model Context Protocol servers for this
            workspace. Changes write to <code>.mitii/mcp.json</code>.
          </p>
        </div>
        <div className="mcp-manager__header-actions">
          <label className="mcp-manager__master">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => void toggleMaster(e.target.checked)}
            />
            <span>Enable MCP</span>
          </label>
          <button
            type="button"
            className="btn-primary mcp-manager__add"
            disabled={busy}
            onClick={openWizard}
          >
            <IconPlus size={15} />
            Add MCP
          </button>
          <button
            type="button"
            className="icon-quiet"
            title="Refresh"
            onClick={() => void reload()}
          >
            <IconRefresh size={16} />
          </button>
        </div>
      </header>

      <div className="mcp-manager__search">
        <IconSearch size={16} />
        <input
          type="search"
          value={query}
          placeholder="Search installed and catalog…"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search MCP servers"
        />
      </div>

      {wizardOpen ? (
        <div className="mcp-wizard">
          <div className="mcp-wizard__steps" aria-label="Add MCP steps">
            <span className={wizardStep === 'source' ? 'is-active' : ''}>
              1 · Source
            </span>
            <span
              className={
                wizardStep === 'catalog' ||
                wizardStep === 'custom-transport' ||
                wizardStep === 'custom-details'
                  ? 'is-active'
                  : ''
              }
            >
              2 · Configure
            </span>
            <span
              className={
                wizardStep === 'catalog' || wizardStep === 'custom-details'
                  ? 'is-active'
                  : ''
              }
            >
              3 · Confirm
            </span>
          </div>

          {wizardStep === 'source' ? (
            <div className="mcp-wizard__panel">
              <h3>How do you want to add an MCP server?</h3>
              <div className="mcp-wizard__choices">
                <button
                  type="button"
                  className="mcp-wizard__choice"
                  onClick={() => setWizardStep('catalog')}
                >
                  <strong>From catalog</strong>
                  <span>
                    Install a Mitii built-in (Excalidraw, Filesystem, Memory, …)
                  </span>
                </button>
                <button
                  type="button"
                  className="mcp-wizard__choice"
                  onClick={() => {
                    setCustom((prev) => ({ ...prev, transport: 'stdio' }));
                    setWizardStep('custom-transport');
                  }}
                >
                  <strong>Custom server</strong>
                  <span>
                    Connect stdio, SSE, or streamable HTTP yourself
                  </span>
                </button>
              </div>
              <div className="mcp-wizard__footer">
                <button type="button" className="btn-ghost" onClick={closeWizard}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {wizardStep === 'catalog' ? (
            <div className="mcp-wizard__panel">
              <h3>Choose a built-in server</h3>
              {availableCatalog.length === 0 ? (
                <p className="workspace-empty">
                  All catalog servers are already installed
                  {q ? ' (or none match your search)' : ''}.
                </p>
              ) : (
                <ul className="mcp-manager__list">
                  {availableCatalog.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={`mcp-manager__card${
                          selectedBuiltin === entry.id ? ' is-selected' : ''
                        }`}
                        onClick={() => setSelectedBuiltin(entry.id)}
                      >
                        <div className="mcp-manager__card-main">
                          <strong>{entry.name}</strong>
                          <small>
                            {entry.id} · {entry.transport}
                          </small>
                          <p>{entry.description}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mcp-wizard__footer">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setWizardStep('source')}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !selectedBuiltin}
                  onClick={() => void installSelectedBuiltin()}
                >
                  Install & enable
                </button>
              </div>
            </div>
          ) : null}

          {wizardStep === 'custom-transport' ? (
            <div className="mcp-wizard__panel">
              <h3>Pick a transport</h3>
              <div className="mcp-wizard__choices">
                {(
                  [
                    [
                      'stdio',
                      'Local process',
                      'Run a command (npx, node, docker, …)',
                    ],
                    [
                      'streamable-http',
                      'Streamable HTTP',
                      'Remote MCP endpoint (e.g. Excalidraw)',
                    ],
                    ['sse', 'SSE', 'Server-Sent Events MCP endpoint'],
                  ] as const
                ).map(([value, title, detail]) => (
                  <button
                    key={value}
                    type="button"
                    className={`mcp-wizard__choice${
                      custom.transport === value ? ' is-selected' : ''
                    }`}
                    onClick={() =>
                      setCustom((prev) => ({ ...prev, transport: value }))
                    }
                  >
                    <strong>{title}</strong>
                    <span>{detail}</span>
                  </button>
                ))}
              </div>
              <div className="mcp-wizard__footer">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setWizardStep('source')}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setWizardStep('custom-details')}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {wizardStep === 'custom-details' ? (
            <div className="mcp-wizard__panel">
              <h3>Server details</h3>
              <div className="mcp-wizard__form">
                <label>
                  Id
                  <input
                    value={custom.id}
                    onChange={(e) =>
                      setCustom((prev) => ({ ...prev, id: e.target.value }))
                    }
                    placeholder="my-server"
                    spellCheck={false}
                  />
                </label>
                <label>
                  Display name
                  <input
                    value={custom.name}
                    onChange={(e) =>
                      setCustom((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="My server"
                  />
                </label>
                {custom.transport === 'stdio' ? (
                  <>
                    <label>
                      Command
                      <input
                        value={custom.command}
                        onChange={(e) =>
                          setCustom((prev) => ({
                            ...prev,
                            command: e.target.value,
                          }))
                        }
                        placeholder="npx"
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      Args (space-separated)
                      <input
                        value={custom.argsText}
                        onChange={(e) =>
                          setCustom((prev) => ({
                            ...prev,
                            argsText: e.target.value,
                          }))
                        }
                        placeholder="-y @modelcontextprotocol/server-memory"
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      Working directory (optional)
                      <input
                        value={custom.cwd}
                        onChange={(e) =>
                          setCustom((prev) => ({
                            ...prev,
                            cwd: e.target.value,
                          }))
                        }
                        placeholder="."
                        spellCheck={false}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      URL
                      <input
                        value={custom.url}
                        onChange={(e) =>
                          setCustom((prev) => ({
                            ...prev,
                            url: e.target.value,
                          }))
                        }
                        placeholder="https://mcp.example.com"
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      Headers (optional, one Name: value per line)
                      <textarea
                        value={custom.headersText}
                        rows={3}
                        onChange={(e) =>
                          setCustom((prev) => ({
                            ...prev,
                            headersText: e.target.value,
                          }))
                        }
                        placeholder="Authorization: Bearer …"
                        spellCheck={false}
                      />
                    </label>
                  </>
                )}
              </div>
              <div className="mcp-wizard__footer">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setWizardStep('custom-transport')}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    busy ||
                    !custom.id.trim() ||
                    !custom.name.trim() ||
                    (custom.transport === 'stdio'
                      ? !custom.command.trim()
                      : !custom.url.trim())
                  }
                  onClick={() => void createCustom()}
                >
                  Create & enable
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mcp-manager__body">
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
                            void toggleServer(server.id, e.target.checked)
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
                        onClick={() => void removeServer(server.id)}
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
                  onClick={openWizard}
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

          <section className="mcp-manager__section">
            <div className="mcp-manager__section-head">
              <h3>Available in catalog</h3>
              <span>{availableCatalog.length}</span>
            </div>
            {availableCatalog.length === 0 ? (
              <p className="workspace-empty">
                {catalog.every((c) => c.installed)
                  ? 'Everything from the Mitii catalog is already installed.'
                  : 'No catalog matches your search.'}
              </p>
            ) : (
              <div className="profile-gallery mcp-manager__gallery">
                {availableCatalog.map((entry) => {
                  const initial = (entry.name.trim()[0] || '?').toUpperCase();
                  return (
                    <div key={entry.id} className="profile-tile">
                      <button
                        type="button"
                        className="profile-tile__body"
                        disabled={busy}
                        onClick={() => {
                          setSelectedBuiltin(entry.id);
                          setWizardOpen(true);
                          setWizardStep('catalog');
                        }}
                      >
                        <span className="profile-tile__avatar" aria-hidden>
                          {initial}
                        </span>
                        <span className="profile-tile__name">{entry.name}</span>
                        <span className="profile-tile__meta">
                          {entry.id} · {entry.transport}
                          {entry.description ? ` · ${entry.description}` : ''}
                        </span>
                        <span className="profile-tile__badge profile-tile__badge--edit">
                          Install
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {note ? <p className="ext-note">{note}</p> : null}
      {error ? <p className="ext-error">{error}</p> : null}
    </div>
  );
}
