import type { CSSProperties } from 'react';

import {
  windowAllocationSlices,
  type WindowAllocationSliceId,
} from '@mitii/live-token-budget';
import type { TokenBudgetPreview } from '../protocol';

const SLICE_COLORS: Record<WindowAllocationSliceId, string> = {
  output: '#c5926b',
  tools: '#8b7bb8',
  repository: '#6f9b7a',
  conversation: '#6f8794',
  plan: '#8da2fb',
  skills: '#c4a35a',
  system: '#7c8794',
};

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.floor(value)),
  );
}

function formatWindowPercent(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

export function TokenBudgetAllocation({
  preview,
}: {
  preview: TokenBudgetPreview;
}) {
  const slices = windowAllocationSlices(preview);

  return (
    <div className="token-budget-allocation" aria-label="Context window split">
      <div
        className="token-budget-allocation__bar"
        role="img"
        aria-label="Module share of the context window"
      >
        {slices.map((slice) =>
          slice.tokens > 0 ? (
            <span
              key={slice.id}
              className="token-budget-allocation__segment"
              title={`${slice.label}: ${formatTokens(slice.tokens)} tokens (${formatWindowPercent(slice.windowShare)} of window)`}
              style={
                {
                  '--token-slice-color': SLICE_COLORS[slice.id],
                  width: `${Math.max(1.5, (Number.isFinite(slice.windowShare) ? slice.windowShare : 0) * 100)}%`,
                } as CSSProperties
              }
            />
          ) : null,
        )}
      </div>
      <ul className="token-budget-allocation__legend">
        {slices.map((slice) => (
          <li key={slice.id}>
            <span
              className="token-budget-allocation__swatch"
              style={
                {
                  '--token-slice-color': SLICE_COLORS[slice.id],
                } as CSSProperties
              }
            />
            <span className="token-budget-allocation__name">{slice.label}</span>
            <span className="token-budget-allocation__pct mono">
              {formatWindowPercent(slice.windowShare)}
            </span>
            <span className="token-budget-allocation__tokens mono">
              {formatTokens(slice.tokens)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
