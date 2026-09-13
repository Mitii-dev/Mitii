interface McpPinChipsProps {
  pinnedIds: string[];
  onRemove: (id: string) => void;
}

/** Composer chips for attached MCP servers (`@mcp:`). */
export function McpPinChips({ pinnedIds, onRemove }: McpPinChipsProps) {
  if (pinnedIds.length === 0) return null;
  return (
    <div className="skill-pin-row" aria-label="Attached MCP servers">
      {pinnedIds.map((serverId) => (
        <span key={serverId} className="skill-pin-chip mono">
          @mcp:{serverId}
          <button
            type="button"
            className="skill-pin-chip__remove"
            aria-label={`Detach ${serverId}`}
            onClick={() => onRemove(serverId)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
