import type { PinnedContextView } from '../../../vscode/webview/messages';
import { IconButton } from './IconButton';

interface ContextPanelProps {
  items: PinnedContextView[];
  onRemove: (path: string) => void;
  onClear: () => void;
  onPick: () => void;
}

export function ContextPanel({ items, onRemove, onClear, onPick }: ContextPanelProps) {
  if (items.length === 0) {
    return (
      <div className="context-panel context-panel--empty">
        <div className="context-panel__header">
          <span className="context-panel__title">Active context</span>
          <button type="button" className="context-panel__add" onClick={onPick}>
            + Add
          </button>
        </div>
        <p className="context-panel__hint">
          Pin files or folders with <kbd>@</kbd> in the input, or use Add to browse. The active editor file is pinned automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="context-panel">
      <div className="context-panel__header">
        <span className="context-panel__title">Active context</span>
        <div className="context-panel__actions">
          <button type="button" className="context-panel__add" onClick={onPick}>
            + Add
          </button>
          <button type="button" className="context-panel__clear" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>
      <ul className="context-panel__list" aria-label="Pinned context">
        {items.map((item) => (
          <li key={`${item.kind}:${item.path}`} className="context-panel__item">
            <span className={`context-chip context-chip--${item.kind}`} title={item.path}>
              <span className="context-chip__kind">{item.kind === 'folder' ? '📁' : '📄'}</span>
              <span className="context-chip__path">{item.path}</span>
              {item.auto && <span className="context-chip__auto">editor</span>}
            </span>
            <IconButton
              label={`Remove ${item.path} from context`}
              variant="ghost"
              className="context-panel__remove"
              onClick={() => onRemove(item.path)}
            >
              ×
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
