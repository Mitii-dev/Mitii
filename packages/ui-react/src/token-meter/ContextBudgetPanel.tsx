import type { CSSProperties } from 'react';

import {
  contextSliceColor,
  formatCompact,
  topLevelSegments,
} from './format.js';
import type { TokenMeterBreakdown } from './types.js';

export interface ContextBudgetPanelProps {
  breakdown: TokenMeterBreakdown | undefined;
  windowTokens: number;
  live?: boolean;
}

type Segment = { id: string; label: string; tokens: number };

function segmentsFor(breakdown: TokenMeterBreakdown): Segment[] {
  const flat = (breakdown.slices ?? []).filter(
    (slice) => slice.active && slice.tokens > 0,
  );
  if (flat.length > 0) {
    return flat.map((slice) => ({
      id: slice.id,
      label: slice.label,
      tokens: slice.tokens,
    }));
  }
  if (breakdown.tree?.length) {
    return topLevelSegments(breakdown.tree).map((row) => ({
      id: row.id,
      label: row.label,
      tokens: row.tokens,
    }));
  }
  return [];
}

/** Enterprise context-window fill: segmented bar + compact legend. */
export function ContextBudgetPanel({
  breakdown,
  windowTokens,
  live,
}: ContextBudgetPanelProps) {
  if (!breakdown) {
    return (
      <div className="token-popover__summary token-popover__summary--start">
        <span>Context usage appears after the prompt is packed.</span>
      </div>
    );
  }

  const segments = segmentsFor(breakdown);
  const fillRatio = breakdown.fillRatio ?? 0;
  const window = Math.max(1, breakdown.contextWindow || windowTokens);
  const pct = Math.round(fillRatio * 100);

  return (
    <section className="token-source-panel" aria-label="Context usage">
      <div className="token-context-usage__header">
        <div className="token-context-usage__title-row">
          <span className="token-context-usage__title">Context</span>
          {live ? (
            <span className="token-context-usage__live">Live</span>
          ) : null}
        </div>
        <div className="token-context-usage__headline">
          <span className="token-context-usage__fill">{pct}% full</span>
          <span className="token-context-usage__meta">
            {formatCompact(breakdown.totalTokens)} / {formatCompact(window)}
          </span>
        </div>
      </div>

      <div
        className="token-fill token-fill--segmented"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Context window fill"
      >
        {segments.map((slice) => {
          const share = slice.tokens / window;
          if (share <= 0) return null;
          return (
            <span
              key={slice.id}
              className="token-fill__segment"
              title={`${slice.label}: ${slice.tokens.toLocaleString()} tokens`}
              style={
                {
                  '--token-slice-color': contextSliceColor(slice.id),
                  width: `${Math.max(0.4, Math.min(100, share * 100))}%`,
                } as CSSProperties
              }
            />
          );
        })}
      </div>

      {segments.length > 0 ? (
        <ul className="token-context-legend">
          {segments.map((slice) => (
            <li key={slice.id} className="token-context-legend__row">
              <span
                className="token-context-legend__swatch"
                style={
                  {
                    '--token-slice-color': contextSliceColor(slice.id),
                  } as CSSProperties
                }
                aria-hidden
              />
              <span className="token-context-legend__label">{slice.label}</span>
              <span className="token-context-legend__value">
                {formatCompact(slice.tokens)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="token-popover__summary token-popover__summary--start">
          <span>No section breakdown for this turn.</span>
        </div>
      )}
    </section>
  );
}
