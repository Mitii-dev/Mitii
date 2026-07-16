import { useState } from 'react';
import type { PinnedContextView } from '../../../vscode/webview/messages';
import { IconChevronDown } from './Icons';
import { IconButton } from './IconButton';

interface ContextPanelProps {
  items: PinnedContextView[];
  onRemove: (path: string) => void;
  onClear: () => void;
  onPick: () => void;
}

export function ContextPanel({ items, onRemove, onClear, onPick }: ContextPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, 3);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className={`context-panel${expanded ? ' context-panel--expanded' : ''}`} aria-label="Active context">
      <div className="context-panel__rail">
        <button type="button" className="context-panel__add" onClick={onPick}>
          Add context
        </button>
        <button
          type="button"
          className="context-panel__toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} active context: ${items.length} item${items.length === 1 ? '' : 's'}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="context-panel__title">Context</span>
          <span className="context-panel__count">{items.length}</span>
          <IconChevronDown className="context-panel__chevron" width={14} height={14} aria-hidden />
        </button>
        <ul className="context-panel__preview-list" aria-label="Pinned context preview">
          {visibleItems.map((item) => (
            <li key={`${item.kind}:${item.path}`} className="context-panel__item">
              <span className={`context-chip context-chip--${item.kind}`} title={item.path}>
                <span className="context-chip__kind">{item.kind === 'folder' ? 'Dir' : 'File'}</span>
                <span className="context-chip__path">{item.path}</span>
                {item.auto && <span className="context-chip__auto">editor</span>}
              </span>
              {expanded && (
                <IconButton
                  label={`Remove ${item.path} from context`}
                  variant="ghost"
                  className="context-panel__remove"
                  onClick={() => onRemove(item.path)}
                >
                  ×
                </IconButton>
              )}
            </li>
          ))}
          {hiddenCount > 0 && (
            <li className="context-panel__more" aria-label={`${hiddenCount} more context items`}>
              +{hiddenCount}
            </li>
          )}
        </ul>
        <button type="button" className="context-panel__clear" onClick={onClear}>
          Clear
        </button>
      </div>
    </section>
  );
}
