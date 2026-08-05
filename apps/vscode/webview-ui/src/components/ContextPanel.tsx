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

function splitPath(path: string): { dir: string; name: string } {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index < 0) return { dir: '', name: normalized };
  return {
    dir: normalized.slice(0, index),
    name: normalized.slice(index + 1) || normalized,
  };
}

export function ContextPanel({
  pins,
  modeColor,
  onRemove,
  onClear,
  onPick,
  onKeep,
}: ContextPanelProps) {
  if (pins.length === 0) return null;

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
      <div className="context-panel__label">
        <span>Context</span>
        <span>{pins.length} pinned</span>
      </div>
      <div className="pins">
        {pins.map((pin) => {
          const file = splitPath(pin.path);
          return (
            <span
              key={pin.path}
              className={`pin-chip${pin.source === 'auto' ? ' pin-chip--auto' : ''}`}
              title={
                pin.source === 'auto'
                  ? `Auto from open editor - ${pin.path}`
                  : pin.path
              }
            >
              <button
                type="button"
                className="pin-chip__path"
                onClick={() => onKeep?.(pin.path)}
                title={
                  pin.source === 'auto'
                    ? `Keep this file in context: ${pin.path}`
                    : pin.path
                }
              >
                <span className="pin-chip__name">@{file.name}</span>
                {file.dir ? (
                  <span className="pin-chip__dir">{file.dir}</span>
                ) : null}
              </button>
              <button
                type="button"
                className="pin-chip__remove"
                aria-label={`Unpin ${pin.path}`}
                title={`Unpin ${pin.path}`}
                onClick={() => onRemove(pin.path)}
              >
                ×
              </button>
            </span>
          );
        })}
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
