import { formatUsd, type SessionCostEstimate } from '@mitii/ui-core';

import { formatPct } from './format.js';

export interface CostCacheChipsProps {
  estimate: SessionCostEstimate | null;
  cacheRatio: number | null;
  cacheHitTokens: number;
  /** Show a muted cache pill when cost is known but the provider omits cache stats. */
  showCacheUnavailable?: boolean;
  open: boolean;
  live?: boolean;
  onToggle: () => void;
}

/** Estimated-cost and cache-hit pills that sit beside the token chip. */
export function CostCacheChips({
  estimate,
  cacheRatio,
  cacheHitTokens,
  showCacheUnavailable,
  open,
  live,
  onToggle,
}: CostCacheChipsProps) {
  if (!estimate && cacheRatio === null && !showCacheUnavailable) return null;
  const active = open ? ' token-chip--active' : '';

  return (
    <div className="token-chip-group" role="group" aria-label="Cost and cache">
      {estimate ? (
        <button
          type="button"
          className={`token-chip token-chip--cost${active}${
            live ? ' token-chip--live' : ''
          }`}
          title={[
            `Estimated session cost: ${formatUsd(estimate.totalUsd)}`,
            `Input ${formatUsd(estimate.inputUsd)} · Output ${formatUsd(estimate.outputUsd)}`,
            estimate.usedCachePricing
              ? `Cache savings ${formatUsd(estimate.cacheSavingsUsd)}`
              : 'Cache hits not reported — billed at full input rate',
            'Rates from models.dev · not an invoice',
          ].join('\n')}
          aria-label={`Estimated cost ${formatUsd(estimate.totalUsd)}`}
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="token-chip__dot token-chip__dot--cost" aria-hidden />
          <span className="token-chip__cost-value">
            {formatUsd(estimate.totalUsd)}
          </span>
          <span className="token-chip__badge">est</span>
        </button>
      ) : null}
      {cacheRatio !== null ? (
        <button
          type="button"
          className={`token-chip token-chip--cache${active}`}
          title={[
            `Cache hit rate: ${formatPct(cacheRatio)}`,
            `Cached ${cacheHitTokens.toLocaleString()} tokens`,
            estimate?.usedCachePricing
              ? `Saved ~${formatUsd(estimate.cacheSavingsUsd)}`
              : null,
          ]
            .filter(Boolean)
            .join('\n')}
          aria-label={`Cache hit ${formatPct(cacheRatio)}`}
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="token-chip__dot token-chip__dot--cache" aria-hidden />
          <span>{formatPct(cacheRatio)}</span>
          <span className="token-chip__badge">cache</span>
        </button>
      ) : showCacheUnavailable ? (
        <button
          type="button"
          className={`token-chip token-chip--cache-na${active}`}
          title="This provider does not report prompt-cache hits yet"
          aria-label="Cache not reported"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="token-chip__dot token-chip__dot--muted" aria-hidden />
          <span>—</span>
          <span className="token-chip__badge">cache</span>
        </button>
      ) : null}
    </div>
  );
}
