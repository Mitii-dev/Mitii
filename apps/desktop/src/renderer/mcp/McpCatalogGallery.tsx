/**
 * Essentials catalog tiles available to install.
 */

import { CATEGORY_LABEL, type CatalogRow } from './mcpManagerTypes.js';

interface Props {
  catalog: CatalogRow[];
  availableCatalog: CatalogRow[];
  busy: boolean;
  onInstall: (entry: CatalogRow) => void;
}

export function McpCatalogGallery(props: Props) {
  const { catalog, availableCatalog, busy } = props;
  return (
    <section className="mcp-manager__section">
      <div className="mcp-manager__section-head">
        <h3>Essentials catalog</h3>
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
            const needsKey = (entry.secrets?.length ?? 0) > 0;
            return (
              <div key={entry.id} className="profile-tile">
                <button
                  type="button"
                  className="profile-tile__body"
                  disabled={busy}
                  title={
                    needsKey
                      ? `Add key and install ${entry.name}`
                      : `Install ${entry.name}`
                  }
                  onClick={() => props.onInstall(entry)}
                >
                  <span className="profile-tile__avatar" aria-hidden>
                    {initial}
                  </span>
                  <span className="profile-tile__name">{entry.name}</span>
                  <span className="profile-tile__meta">
                    {CATEGORY_LABEL[entry.category ?? ''] ??
                      entry.category ??
                      'Catalog'}
                    {needsKey ? ' · needs key' : ''}
                    {entry.description ? ` · ${entry.description}` : ''}
                  </span>
                  <span className="profile-tile__badge profile-tile__badge--edit">
                    {needsKey ? 'Add key' : 'Add'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
