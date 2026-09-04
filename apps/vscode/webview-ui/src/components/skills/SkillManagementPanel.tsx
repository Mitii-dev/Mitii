import { useEffect, useState } from 'react';

import type { SkillCatalogItem } from '../../protocol';
import { postToHost } from '../../bridge';

interface SkillManagementPanelProps {
  items: SkillCatalogItem[];
  error?: string | null;
  loading?: boolean;
  pinnedSkillIds?: string[];
  onPinSkill?: (skillId: string) => void;
  onUnpinSkill?: (skillId: string) => void;
}

function requestId(): string {
  return `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function SkillManagementPanel({
  items,
  error,
  loading,
  pinnedSkillIds = [],
  onPinSkill,
  onUnpinSkill,
}: SkillManagementPanelProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    postToHost({
      type: 'requestSkillCatalog',
      requestId: requestId(),
      query: '',
    });
  }, []);

  const search = () => {
    postToHost({
      type: 'requestSkillCatalog',
      requestId: requestId(),
      query: query.trim() || undefined,
    });
  };

  return (
    <div className="panel-view skill-management">
      <header className="panel-header-row">
        <div>
          <h2>Skills</h2>
          <p className="field-hint">
            Pin skills for the next message or type <code>@skill:id</code> in chat.
          </p>
        </div>
      </header>
      <div className="row">
        <input
          value={query}
          placeholder="Search skills…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') search();
          }}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn" onClick={search}>
          Search
        </button>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <p className="field-hint">Loading…</p> : null}
      {items.length === 0 && !loading ? (
        <p className="panel-empty">No skills found.</p>
      ) : (
        <ul className="skill-list">
          {items.map((item) => {
            const pinned = pinnedSkillIds.includes(item.id);
            return (
              <li key={item.id} className="skill-item">
                <div className="skill-item__top">
                  <strong>{item.name}</strong>
                  <span className={`skill-badge ${item.enabled ? 'on' : 'off'}`}>
                    {item.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                {item.description ? (
                  <p className="skill-item__desc">{item.description}</p>
                ) : null}
                <div className="skill-item__actions">
                  <span className="mono">{item.id}</span>
                  {pinned ? (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => onUnpinSkill?.(item.id)}
                    >
                      Unpin
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={pinnedSkillIds.length >= 3}
                      onClick={() => onPinSkill?.(item.id)}
                    >
                      Pin for next message
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
