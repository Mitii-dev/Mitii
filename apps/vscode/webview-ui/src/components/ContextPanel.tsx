import { IconButton } from './IconButton';
import { IconPlus, IconTrash } from './Icons';

interface ContextPanelProps {
  paths: string[];
  onRemove: (path: string) => void;
  onClear: () => void;
  onPick: () => void;
}

export function ContextPanel({
  paths,
  onRemove,
  onClear,
  onPick,
}: ContextPanelProps) {
  if (paths.length === 0) {
    return null;
  }

  return (
    <section className="context-panel" aria-label="Pinned context">
      <div className="pins">
        {paths.map((p) => (
          <span key={p} className="pin-chip">
            @{p}
            <button
              type="button"
              aria-label={`Unpin ${p}`}
              title={`Unpin ${p}`}
              onClick={() => onRemove(p)}
            >
              ×
            </button>
          </span>
        ))}
        <IconButton label="Pin files or folders" variant="ghost" onClick={onPick}>
          <IconPlus />
        </IconButton>
        <IconButton label="Clear pinned context" variant="ghost" onClick={onClear}>
          <IconTrash />
        </IconButton>
      </div>
    </section>
  );
}
