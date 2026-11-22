/**
 * Full-screen Code-mode MCP manager: search, install catalog, create custom, delete.
 */

import { IconPlus, IconRefresh, IconSearch } from '../shell/ActivityIcons.js';
import { useMcpManager } from './hooks/useMcpManager.js';
import { McpAddWizard } from './McpAddWizard.js';
import { McpCatalogGallery } from './McpCatalogGallery.js';
import { McpServerGallery } from './McpServerGallery.js';

interface Props {
  baseUrl: string;
  token?: string;
  onRestartEngine?: () => Promise<void>;
}

export function McpManager(props: Props) {
  const m = useMcpManager(props);

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
              checked={m.enabled}
              disabled={m.busy}
              onChange={(e) => void m.toggleMaster(e.target.checked)}
            />
            <span>Enable MCP</span>
          </label>
          <button
            type="button"
            className="btn-primary mcp-manager__add"
            disabled={m.busy}
            onClick={m.openWizard}
          >
            <IconPlus size={15} />
            Add MCP
          </button>
          <button
            type="button"
            className="icon-quiet"
            title="Refresh"
            onClick={() => void m.reload()}
          >
            <IconRefresh size={13} />
          </button>
        </div>
      </header>

      <div className="mcp-manager__search">
        <IconSearch size={13} />
        <input
          type="search"
          value={m.query}
          placeholder="Search installed and catalog…"
          onChange={(e) => m.setQuery(e.target.value)}
          aria-label="Search MCP servers"
        />
      </div>

      {m.wizardOpen ? (
        <McpAddWizard
          wizardStep={m.wizardStep}
          setWizardStep={m.setWizardStep}
          busy={m.busy}
          q={m.q}
          availableCatalog={m.availableCatalog}
          selectedBuiltin={m.selectedBuiltin}
          setSelectedBuiltin={m.setSelectedBuiltin}
          selectedCatalogEntry={m.selectedCatalogEntry}
          secretDraft={m.secretDraft}
          setSecretDraft={m.setSecretDraft}
          dbConnectMethod={m.dbConnectMethod}
          setDbConnectMethod={m.setDbConnectMethod}
          custom={m.custom}
          setCustom={m.setCustom}
          setError={m.setError}
          closeWizard={m.closeWizard}
          installSelectedBuiltin={m.installSelectedBuiltin}
          confirmCatalogSecrets={m.confirmCatalogSecrets}
          createCustom={m.createCustom}
        />
      ) : (
        <div className="mcp-manager__body">
          <McpServerGallery
            servers={m.servers}
            filteredServers={m.filteredServers}
            busy={m.busy}
            onToggle={m.toggleServer}
            onRemove={m.removeServer}
            onAdd={m.openWizard}
          />
          <McpCatalogGallery
            catalog={m.catalog}
            availableCatalog={m.availableCatalog}
            busy={m.busy}
            onInstall={m.beginCatalogInstall}
          />
        </div>
      )}

      {m.note ? <p className="ext-note">{m.note}</p> : null}
      {m.error ? <p className="ext-error">{m.error}</p> : null}
    </div>
  );
}
