/**
 * Add-MCP wizard: pick a source, configure a catalog or custom server, confirm.
 */

import { DatabaseMcpSecretsForm } from './DatabaseMcpSecretsForm.js';
import type { McpManagerModel } from './hooks/useMcpManager.js';
import { CATEGORY_LABEL, type Transport } from './mcpManagerTypes.js';

type Props = Pick<
  McpManagerModel,
  | 'wizardStep'
  | 'setWizardStep'
  | 'busy'
  | 'q'
  | 'availableCatalog'
  | 'selectedBuiltin'
  | 'setSelectedBuiltin'
  | 'selectedCatalogEntry'
  | 'secretDraft'
  | 'setSecretDraft'
  | 'dbConnectMethod'
  | 'setDbConnectMethod'
  | 'custom'
  | 'setCustom'
  | 'setError'
  | 'closeWizard'
  | 'installSelectedBuiltin'
  | 'confirmCatalogSecrets'
  | 'createCustom'
>;

const TRANSPORT_CHOICES: ReadonlyArray<
  readonly [Transport, string, string]
> = [
  ['stdio', 'Local process', 'Run a command (npx, node, docker, …)'],
  [
    'streamable-http',
    'Streamable HTTP',
    'Remote MCP endpoint (e.g. Excalidraw)',
  ],
  ['sse', 'SSE', 'Server-Sent Events MCP endpoint'],
];

export function McpAddWizard(props: Props) {
  const {
    wizardStep,
    setWizardStep,
    busy,
    q,
    availableCatalog,
    selectedBuiltin,
    setSelectedBuiltin,
    selectedCatalogEntry,
    secretDraft,
    setSecretDraft,
    dbConnectMethod,
    setDbConnectMethod,
    custom,
    setCustom,
    setError,
    closeWizard,
  } = props;

  const patchCustom = (patch: Partial<typeof custom>) =>
    setCustom((prev) => ({ ...prev, ...patch }));

  const configureActive =
    wizardStep === 'catalog' ||
    wizardStep === 'catalog-secrets' ||
    wizardStep === 'custom-transport' ||
    wizardStep === 'custom-details';
  const confirmActive =
    wizardStep === 'catalog' ||
    wizardStep === 'catalog-secrets' ||
    wizardStep === 'custom-details';

  return (
    <div className="mcp-wizard">
      <div className="mcp-wizard__steps" aria-label="Add MCP steps">
        <span className={wizardStep === 'source' ? 'is-active' : ''}>
          1 · Source
        </span>
        <span className={configureActive ? 'is-active' : ''}>
          2 · Configure
        </span>
        <span className={confirmActive ? 'is-active' : ''}>3 · Confirm</span>
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
                Essentials: GitHub, Gitea, Brave, Playwright, Filesystem, …
              </span>
            </button>
            <button
              type="button"
              className="mcp-wizard__choice"
              onClick={() => {
                patchCustom({ transport: 'stdio' });
                setWizardStep('custom-transport');
              }}
            >
              <strong>Custom server</strong>
              <span>Connect stdio, SSE, or streamable HTTP yourself</span>
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
                        {CATEGORY_LABEL[entry.category ?? ''] ??
                          entry.category ??
                          'Catalog'}{' '}
                        · {entry.id} · {entry.transport}
                        {(entry.secrets?.length ?? 0) > 0 ? ' · needs key' : ''}
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
              onClick={() => void props.installSelectedBuiltin()}
            >
              {(selectedCatalogEntry?.secrets?.length ?? 0) > 0
                ? 'Continue'
                : 'Install & enable'}
            </button>
          </div>
        </div>
      ) : null}

      {wizardStep === 'catalog-secrets' && selectedCatalogEntry ? (
        <div className="mcp-wizard__panel">
          <h3>Configure {selectedCatalogEntry.name}</h3>
          {selectedCatalogEntry.category === 'database' && selectedBuiltin ? (
            <DatabaseMcpSecretsForm
              builtinId={selectedBuiltin}
              fields={selectedCatalogEntry.secrets ?? []}
              draft={secretDraft}
              onChange={setSecretDraft}
              method={dbConnectMethod}
              onMethodChange={setDbConnectMethod}
            />
          ) : (
            <>
              <p className="mcp-wizard__hint">
                Add your key once — Mitii writes it into{' '}
                <code>.mitii/mcp.json</code> env and enables the server.
              </p>
              <div className="mcp-wizard__fields">
                {(selectedCatalogEntry.secrets ?? []).map((field) => (
                  <label key={field.key}>
                    {field.label}
                    {field.required === false ? ' (optional)' : ''}
                    <input
                      type={field.secret ? 'password' : 'text'}
                      value={secretDraft[field.key] ?? ''}
                      placeholder={field.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        setSecretDraft((prev) => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                    />
                    {field.hint ? (
                      <span className="mcp-wizard__field-hint">
                        {field.hint}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="mcp-wizard__footer">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setError(null);
                if (availableCatalog.some((c) => c.id === selectedBuiltin)) {
                  setWizardStep('catalog');
                } else {
                  closeWizard();
                }
              }}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void props.confirmCatalogSecrets()}
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
            {TRANSPORT_CHOICES.map(([value, title, detail]) => (
              <button
                key={value}
                type="button"
                className={`mcp-wizard__choice${
                  custom.transport === value ? ' is-selected' : ''
                }`}
                onClick={() => patchCustom({ transport: value })}
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
                onChange={(e) => patchCustom({ id: e.target.value })}
                placeholder="my-server"
                spellCheck={false}
              />
            </label>
            <label>
              Display name
              <input
                value={custom.name}
                onChange={(e) => patchCustom({ name: e.target.value })}
                placeholder="My server"
              />
            </label>
            {custom.transport === 'stdio' ? (
              <>
                <label>
                  Command
                  <input
                    value={custom.command}
                    onChange={(e) => patchCustom({ command: e.target.value })}
                    placeholder="npx"
                    spellCheck={false}
                  />
                </label>
                <label>
                  Args (space-separated)
                  <input
                    value={custom.argsText}
                    onChange={(e) => patchCustom({ argsText: e.target.value })}
                    placeholder="-y @modelcontextprotocol/server-memory"
                    spellCheck={false}
                  />
                </label>
                <label>
                  Working directory (optional)
                  <input
                    value={custom.cwd}
                    onChange={(e) => patchCustom({ cwd: e.target.value })}
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
                    onChange={(e) => patchCustom({ url: e.target.value })}
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
                      patchCustom({ headersText: e.target.value })
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
              onClick={() => void props.createCustom()}
            >
              Create & enable
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
