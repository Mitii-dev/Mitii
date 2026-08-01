import type { CSSProperties } from 'react';

import type { ContextPinSource } from '../protocol';
import { IconButton } from './IconButton';
import { IconPlus, IconTrash } from './Icons';

export interface ContextPin {
  path: string;
  source: ContextPinSource;
}

interface ContextPanelProps {
  pins: ContextPin[];
  modeColor?: string;
  onRemove: (path: string) => void;
  onClear: () => void;
  onPick: () => void;
  onKeep?: (path: string) => void;
}

export function ContextPanel({
  pins,
  modeColor,
  onRemove,
  onClear,
  onPick,
  onKeep,
}: ContextPanelProps) {
  return (
    <section
      className={`context-panel${pins.length === 0 ? ' context-panel--empty' : ''}`}
      aria-label="Pinned context"
      style={
        modeColor
          ? ({ '--pin-mode-color': modeColor } as CSSProperties)
          : undefined
      }
    >
      <div className="context-panel__label">
        <span>Context</span>
        {pins.length > 0 ? (
          <span>{pins.length} pinned</span>
        ) : (
          <span>No files pinned</span>
        )}
      </div>
      <div className="pins">
        {pins.length > 0 ? (
          pins.map((pin) => (
            <span
              key={pin.path}
              className={`pin-chip${pin.source === 'auto' ? ' pin-chip--auto' : ''}`}
              title={
                pin.source === 'auto'
                  ? 'Auto from open editor - closes with the tab'
                  : pin.path
              }
            >
              <button
                type="button"
                className="pin-chip__path"
                onClick={() => onKeep?.(pin.path)}
                title={
                  pin.source === 'auto'
                    ? 'Keep this file in context'
                    : pin.path
                }
              >
                @{pin.path}
              </button>
              <button
                type="button"
                aria-label={`Unpin ${pin.path}`}
                title={`Unpin ${pin.path}`}
                onClick={() => onRemove(pin.path)}
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="context-empty-text">
            Type @ to search files, or pin files here.
          </span>
        )}
        <IconButton label="Pin files or folders" variant="ghost" onClick={onPick}>
          <IconPlus />
        </IconButton>
        {pins.length > 0 ? (
          <IconButton label="Clear pinned context" variant="ghost" onClick={onClear}>
            <IconTrash />
          </IconButton>
        ) : null}
      </div>
    </section>
  );
}
