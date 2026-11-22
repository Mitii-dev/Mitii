import { formatUsd, type SessionCostEstimate } from '@mitii/ui-core';

import { formatCompact, formatPct } from './format.js';

export interface CostAnalyticsProps {
  estimate: SessionCostEstimate | null;
  showCacheSection: boolean;
  cacheRatio: number | null;
  cacheHitTokens: number;
  cacheMissTokens: number;
  inputTokensTotal: number;
}

/** Cost / cache cards and the hit-vs-miss bar shown in the detail popover. */
export function CostAnalytics({
  estimate,
  showCacheSection,
  cacheRatio,
  cacheHitTokens,
  cacheMissTokens,
  inputTokensTotal,
}: CostAnalyticsProps) {
  const hit = cacheHitTokens;
  const miss =
    cacheMissTokens > 0 ? cacheMissTokens : Math.max(0, inputTokensTotal - hit);
  const total = hit + miss;
  const hitShare = total > 0 ? hit / total : 0;
  const missShare = total > 0 ? miss / total : 0;
  const hasCacheCounters = cacheHitTokens > 0 || cacheMissTokens > 0;

  return (
    <section className="token-analytics" aria-label="Cost and cache analytics">
      <div className="token-analytics__grid">
        {estimate ? (
          <div className="token-stat-card token-stat-card--cost">
            <div className="token-stat-card__label">
              <span className="token-chip__dot token-chip__dot--cost" />
              Est. cost
            </div>
            <div className="token-stat-card__value">
              {formatUsd(estimate.totalUsd)}
            </div>
            <div className="token-stat-card__meta">models.dev · not billed</div>
          </div>
        ) : null}
        {estimate ? (
          <div className="token-stat-card">
            <div className="token-stat-card__label">Input / out</div>
            <div className="token-stat-card__value token-stat-card__value--split">
              <span>{formatUsd(estimate.inputUsd)}</span>
              <span className="token-stat-card__sep">/</span>
              <span>{formatUsd(estimate.outputUsd)}</span>
            </div>
            <div className="token-stat-card__meta">
              @ {estimate.rates.input}/{estimate.rates.output} per 1M
            </div>
          </div>
        ) : null}
        {showCacheSection ? (
          <div className="token-stat-card token-stat-card--cache">
            <div className="token-stat-card__label">
              <span className="token-chip__dot token-chip__dot--cache" />
              Cache hit
            </div>
            <div className="token-stat-card__value">
              {cacheRatio !== null ? formatPct(cacheRatio) : '—'}
            </div>
            <div className="token-stat-card__meta">
              {cacheHitTokens > 0
                ? `${formatCompact(cacheHitTokens)} cached`
                : 'Not reported by provider'}
            </div>
          </div>
        ) : null}
        {estimate?.usedCachePricing ? (
          <div className="token-stat-card token-stat-card--savings">
            <div className="token-stat-card__label">Cache savings</div>
            <div className="token-stat-card__value">
              {formatUsd(estimate.cacheSavingsUsd)}
            </div>
            <div className="token-stat-card__meta">vs full input rate</div>
          </div>
        ) : null}
      </div>

      {showCacheSection && hasCacheCounters ? (
        <div className="token-cache-bar" aria-label="Cache composition">
          <div className="token-cache-bar__track">
            {hitShare > 0 ? (
              <span
                className="token-cache-bar__hit"
                style={{ width: `${hitShare * 100}%` }}
                title={`Hit ${hit.toLocaleString()}`}
              />
            ) : null}
            {missShare > 0 ? (
              <span
                className="token-cache-bar__miss"
                style={{ width: `${missShare * 100}%` }}
                title={`Miss ${miss.toLocaleString()}`}
              />
            ) : null}
          </div>
          <div className="token-cache-bar__legend">
            <span>
              <i className="token-cache-bar__swatch token-cache-bar__swatch--hit" />
              Hit {formatCompact(cacheHitTokens)}
            </span>
            <span>
              <i className="token-cache-bar__swatch token-cache-bar__swatch--miss" />
              Miss {formatCompact(miss)}
            </span>
          </div>
        </div>
      ) : estimate && !estimate.usedCachePricing ? (
        <div className="token-popover__summary token-popover__summary--note">
          Provider did not report cache hits. Cost uses full input rates (may
          overestimate when caching is active).
        </div>
      ) : null}
    </section>
  );
}
