/** @-mention / pin suggestion popover. */

import type { AppModel } from '../app/useAppModel.js';

export function SuggestMenu({ m }: { m: AppModel }) {
  const {
    pinMenu,
    suggestLoading,
    suggestItems,
    mention,
    suggestIndex,
    setSuggestIndex,
    applySuggestItem,
    pinnedSkillIds,
    pinnedMcpIds,
  } = m;

  return pinMenu ? (
    <div
      className="composer-suggest"
      role="listbox"
      aria-label="Mention suggestions"
    >
      {suggestLoading && suggestItems.length === 0 ? (
        <button type="button" disabled>
          Searching…
        </button>
      ) : null}
      {!suggestLoading && suggestItems.length === 0 ? (
        <button type="button" disabled>
          {mention?.query
            ? `No matches for “${mention.query}”`
            : 'Type to filter files, folders, skills, MCP'}
        </button>
      ) : null}
      {suggestItems.map((item, index) => {
        if (item.kind === 'file' || item.kind === 'folder') {
          return (
            <button
              key={`${item.kind}:${item.path}`}
              type="button"
              role="option"
              className={index === suggestIndex ? 'is-selected' : undefined}
              aria-selected={index === suggestIndex}
              onMouseEnter={() => setSuggestIndex(index)}
              onClick={() => applySuggestItem(item)}
            >
              <span className="composer-attach__item-icon" aria-hidden>
                {item.kind === 'folder' ? '▤' : '⌗'}
              </span>
              <span>
                {item.path}
                <small>{item.kind === 'folder' ? 'Folder' : 'File'}</small>
              </span>
            </button>
          );
        }
        if (item.kind === 'skill') {
          return (
            <button
              key={`skill:${item.id}`}
              type="button"
              role="option"
              className={
                index === suggestIndex || pinnedSkillIds.includes(item.id)
                  ? 'is-selected'
                  : undefined
              }
              aria-selected={index === suggestIndex}
              onMouseEnter={() => setSuggestIndex(index)}
              onClick={() => applySuggestItem(item)}
            >
              <span className="composer-attach__item-icon" aria-hidden>
                /
              </span>
              <span>
                {item.title || item.id}
                <small>
                  Skill
                  {item.description ? ` · ${item.description}` : ''}
                </small>
              </span>
            </button>
          );
        }
        return (
          <button
            key={`mcp:${item.id}`}
            type="button"
            role="option"
            className={
              index === suggestIndex || pinnedMcpIds.includes(item.id)
                ? 'is-selected'
                : undefined
            }
            aria-selected={index === suggestIndex}
            onMouseEnter={() => setSuggestIndex(index)}
            onClick={() => applySuggestItem(item)}
          >
            <span className="composer-attach__item-icon" aria-hidden>
              ⎈
            </span>
            <span>
              {item.name || item.id}
              <small>MCP · {item.enabled ? 'enabled' : 'disabled'}</small>
            </span>
          </button>
        );
      })}
    </div>
  ) : null;
}
