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
  if (pins.length === 0) {
    return null;
  }

  return (
    <section
      className="context-panel"
      aria-label="Pinned context"
      style={
        modeColor
          ? ({ '--pin-mode-color': modeColor } as CSSProperties)
          : undefined
      }
    >
      <div className="pins">
        {pins.map((pin) => (
          <span
            key={pin.path}
            className={`pin-chip${pin.source === 'auto' ? ' pin-chip--auto' : ''}`}
            title={
              pin.source === 'auto'
                ? 'Auto from open editor — closes with the tab'
                : 'Pinned context'
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
