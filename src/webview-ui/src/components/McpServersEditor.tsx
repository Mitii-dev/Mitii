import { useEffect, useState } from 'react';
import type { McpCustomServerView } from '../../../vscode/webview/messages';

interface McpServersEditorProps {
  servers: McpCustomServerView[];
  workspaceOpen: boolean;
  onSave: (servers: McpCustomServerView[]) => void;
}

const EMPTY_FORM = {
  name: '',
  type: 'stdio' as 'stdio' | 'sse' | 'streamable-http',
  command: 'npx',
  args: '',
  env: '',
  cwd: '',
  url: '',
  headers: '',
  disabled: false,
};

export function McpServersEditor({ servers, workspaceOpen, onSave }: McpServersEditorProps) {
  const [editing, setEditing] = useState<McpCustomServerView[]>(servers);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEditing(servers);
  }, [servers]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setError(null);
  };

  const parseArgs = (value: string): string[] =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  const parseEnv = (value: string): Record<string, string> => {
    if (!value.trim()) return {};
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      );
    } catch {
      throw new Error('Environment must be valid JSON, e.g. {"API_KEY":"..."}');
    }
  };

  const handleAdd = () => {
    try {
      const name = form.name.trim();
      const command = form.command.trim();
      if (!name || (form.type === 'stdio' ? !command : !form.url.trim())) {
        setError(form.type === 'stdio' ? 'Server name and command are required.' : 'Server name and URL are required.');
        return;
      }
      if (editing.some((server) => server.name === name)) {
        setError(`A server named "${name}" already exists.`);
        return;
      }
      const next: McpCustomServerView = {
        name,
        type: form.type,
        command,
        args: parseArgs(form.args),
        env: parseEnv(form.env),
        cwd: form.cwd.trim() || undefined,
        url: form.url.trim() || undefined,
        headers: form.headers.trim() ? parseEnv(form.headers) : undefined,
        disabled: form.disabled,
        source: workspaceOpen ? 'workspace' : 'settings',
      };
      setEditing((current) => [...current, next].sort((a, b) => a.name.localeCompare(b.name)));
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemove = (name: string) => {
    setEditing((current) => current.filter((server) => server.name !== name));
  };

  const handleSave = () => {
    onSave(editing);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="mcp-servers-editor">
      <p className="settings-inline-note">
        {workspaceOpen
          ? 'Custom servers are saved to .mitii/mcp.json in your workspace.'
          : 'Custom servers are saved to VS Code settings until a workspace folder is open.'}
      </p>

      {editing.length > 0 ? (
        <ul className="settings-mcp-list">
          {editing.map((server) => (
            <li key={server.name} className="settings-mcp-item settings-mcp-item--editable">
              <span className="settings-mcp-name">
                {server.name}
                <span className="settings-mcp-badge">{server.source}</span>
              </span>
              <span className="settings-mcp-meta">
                {server.type && server.type !== 'stdio' ? `${server.type} ${server.url ?? ''}` : `${server.command} ${server.args.join(' ')}`}
              </span>
              <button
                type="button"
                className="settings-mcp-remove"
                onClick={() => handleRemove(server.name)}
                aria-label={`Remove ${server.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-inline-note">No custom MCP servers yet.</p>
      )}

      <div className="mcp-servers-form">
        <label className="settings-field">
          <span className="settings-label">Server name</span>
          <input
            className="settings-input"
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            placeholder="my-server"
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Transport</span>
          <select
            className="settings-input settings-select"
            value={form.type}
            onChange={(e) => setForm((current) => ({
              ...current,
              type: e.target.value as 'stdio' | 'sse' | 'streamable-http',
            }))}
          >
            <option value="stdio">Stdio (local process)</option>
            <option value="sse">HTTP SSE (remote)</option>
            <option value="streamable-http">Streamable HTTP (remote)</option>
          </select>
        </label>
        {form.type === 'stdio' ? (
          <>
        <label className="settings-field">
          <span className="settings-label">Command</span>
          <input
            className="settings-input"
            value={form.command}
            onChange={(e) => setForm((current) => ({ ...current, command: e.target.value }))}
            placeholder="npx"
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Args (one per line)</span>
          <textarea
            className="settings-input settings-textarea"
            value={form.args}
            onChange={(e) => setForm((current) => ({ ...current, args: e.target.value }))}
            placeholder={'-y\n@modelcontextprotocol/server-filesystem\n.'}
            rows={3}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Environment JSON (optional)</span>
          <input
            className="settings-input"
            value={form.env}
            onChange={(e) => setForm((current) => ({ ...current, env: e.target.value }))}
            placeholder='{"API_KEY":"..."}'
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Working directory (optional)</span>
          <input
            className="settings-input"
            value={form.cwd}
            onChange={(e) => setForm((current) => ({ ...current, cwd: e.target.value }))}
            placeholder="."
          />
        </label>
          </>
        ) : (
          <>
            <label className="settings-field">
              <span className="settings-label">Server URL</span>
              <input
                className="settings-input"
                value={form.url}
                onChange={(e) => setForm((current) => ({ ...current, url: e.target.value }))}
                placeholder="https://mcp.example.com/sse"
              />
            </label>
            <label className="settings-field">
              <span className="settings-label">Headers JSON (optional, OAuth bearer)</span>
              <input
                className="settings-input"
                value={form.headers}
                onChange={(e) => setForm((current) => ({ ...current, headers: e.target.value }))}
                placeholder='{"Authorization":"Bearer ..."}'
              />
            </label>
          </>
        )}
        <label className="toggle-label mcp-servers-form__disabled">
          <input
            type="checkbox"
            checked={form.disabled}
            onChange={(e) => setForm((current) => ({ ...current, disabled: e.target.checked }))}
          />
          Start disabled
        </label>
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="mcp-servers-form__actions">
          <button type="button" className="settings-btn settings-btn--secondary" onClick={handleAdd}>
            Add server
          </button>
          <button type="button" className="settings-btn" onClick={handleSave}>
            {saved ? 'Saved' : 'Save MCP servers'}
          </button>
        </div>
      </div>
    </div>
  );
}
