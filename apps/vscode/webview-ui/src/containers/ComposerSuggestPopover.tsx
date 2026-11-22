import { type AppApi } from '../app/appApi';

export function ComposerSuggestPopover({ api }: { api: AppApi }) {
  const {
    activeSuggest,
    allSuggestItems,
    filteredMcpSuggestions,
    filteredSkillSuggestions,
    insertMention,
    mcp,
    selectMcp,
    selectSkill,
    suggestKind,
    suggestLoading,
    suggestOpen,
    suggestions,
  } = api;

  if (!(suggestOpen)) return null;

  return (
    <div className="suggest-pop" role="listbox">
      {suggestLoading ? (
        <div className="suggest-item suggest-item--loading">
          <span className="mono">
            {suggestKind === 'skill'
              ? 'Loading skills…'
              : suggestKind === 'mcp'
                ? 'Loading MCP…'
                : suggestKind === 'all'
                  ? 'Loading mentions…'
                  : 'Loading files…'}
          </span>
        </div>
      ) : null}
      {suggestKind === 'skill' ? (
        <>
          {!suggestLoading && filteredSkillSuggestions.length === 0 ? (
            <div className="suggest-item suggest-item--loading">
              <span className="mono">No matching skills</span>
            </div>
          ) : null}
          {!suggestLoading
            ? filteredSkillSuggestions.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
                  onClick={() => selectSkill(item.id)}
                >
                  <span className="mono">@skill:{item.id}</span>
                  <span className="suggest-kind">{item.name}</span>
                </button>
              ))
            : null}
        </>
      ) : suggestKind === 'mcp' ? (
        <>
          {filteredMcpSuggestions.length === 0 ? (
            <div className="suggest-item suggest-item--loading">
              <span className="mono">
                {mcp.enabled
                  ? 'No matching MCP servers'
                  : 'Enable MCP in Settings first'}
              </span>
            </div>
          ) : null}
          {filteredMcpSuggestions.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
              onClick={() => selectMcp(item.id)}
            >
              <span className="mono">@mcp:{item.id}</span>
              <span className="suggest-kind">{item.name}</span>
            </button>
          ))}
        </>
      ) : suggestKind === 'all' ? (
        <>
          {!suggestLoading && allSuggestItems.length === 0 ? (
            <div className="suggest-item suggest-item--loading">
              <span className="mono">No matches — try @skill, @mcp, or a path</span>
            </div>
          ) : null}
          {allSuggestItems.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
              onClick={() => {
                if (item.type === 'skill') {
                  selectSkill(item.id.slice('skill:'.length));
                } else if (item.type === 'mcp') {
                  selectMcp(item.id.slice('mcp:'.length));
                } else {
                  insertMention(item.id.slice('path:'.length));
                }
              }}
            >
              <span className="mono">{item.label}</span>
              <span className="suggest-kind">{item.sub}</span>
            </button>
          ))}
        </>
      ) : (
        <>
          {!suggestLoading && suggestions.length === 0 ? (
            <div className="suggest-item suggest-item--loading">
              <span className="mono">No matching files</span>
            </div>
          ) : null}
          {!suggestLoading ? suggestions.map((s, i) => (
            <button
              key={s.path}
              type="button"
              className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
              onClick={() => insertMention(s.path)}
            >
              <span className="mono">@{s.path}</span>
              <span className="suggest-kind">{s.kind}</span>
            </button>
          )) : null}
        </>
      )}
    </div>
  );
}
