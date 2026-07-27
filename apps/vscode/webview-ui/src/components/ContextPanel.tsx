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
        <button type="button" className="btn ghost" onClick={onPick} title="Pin files or folders">
          Add
        </button>
        <button type="button" className="btn ghost" onClick={onClear} title="Clear pinned context">
          Clear
        </button>
      </div>
    </section>
  );
}
