import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import {
  estimateSessionCost,
  formatUsd,
  type ModelCostRates,
} from '@mitii/ui-core';

import { ContextBudgetPanel } from './ContextBudgetPanel.js';
import { CostAnalytics } from './CostAnalytics.js';
import { CostCacheChips } from './CostCacheChips.js';
import { cacheHitRatio, formatCompact, formatPct } from './format.js';
import type { TokenMeterUsage } from './types.js';
import { UsageStats, type LiveStatsLayout } from './UsageStats.js';

export interface TokenMeterProps {
  usage: TokenMeterUsage;
  /** models.dev rates for the active profile; null hides the cost chip. */
  costRates?: ModelCostRates | null;
  /** Adds a `token-popover--{placement}` class so hosts can anchor the panel. */
  placement?: 'above' | 'below';
  /** Optional icon rendered inside the token chip. */
  glyph?: ReactNode;
  /** Label for the header tag when totals are provider-reported. */
  reportedLabel?: string;
  /** Layout of the stats block while a run is live. */
  liveStatsLayout?: LiveStatsLayout;
}

function usePopoverDismiss(
  open: boolean,
  setOpen: (open: boolean) => void,
  rootRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen, rootRef]);
}

/** Chat token chip with a detail popover (cost, cache, context window budget). */
export function TokenMeter({
  usage,
  costRates = null,
  placement,
  glyph,
  reportedLabel = 'Reported',
  liveStatsLayout = 'compact',
}: TokenMeterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, setOpen, rootRef);

  const inputTotal = usage.inputTokensTotal;
  const outputTotal = usage.outputTokensTotal;
  const sessionTotal = usage.sessionTotal || inputTotal + outputTotal;
  const cacheHitTokens = usage.cacheHitTokens ?? 0;
  const cacheMissTokens = usage.cacheMissTokens ?? 0;
  const turns = usage.turns ?? [];
  const latestCall = turns[turns.length - 1];
  const breakdown = usage.contextBreakdown;
  const fillRatio = breakdown?.fillRatio ?? 0;
  const windowTokens = breakdown?.contextWindow ?? usage.contextWindow;

  const estimate = useMemo(
    () =>
      estimateSessionCost(costRates, {
        inputTokens: inputTotal,
        outputTokens: outputTotal,
        cacheHitTokens,
        cacheMissTokens,
      }),
    [costRates, inputTotal, outputTotal, cacheHitTokens, cacheMissTokens],
  );
  const showCost =
    Boolean(estimate) &&
    (sessionTotal > 0 || inputTotal > 0 || outputTotal > 0 || Boolean(usage.live));
  const displayEstimate = showCost ? estimate : null;
  const cacheRatio = cacheHitRatio(usage);
  const showCacheSection =
    cacheHitTokens > 0 ||
    cacheMissTokens > 0 ||
    Boolean(displayEstimate?.usedCachePricing);

  const latestInput = latestCall?.inputTokens ?? usage.lastPromptTokens;
  const latestOutput = latestCall?.outputTokens ?? usage.lastResponseTokens;
  const tooltip = [
    usage.live ? 'Live · updating cumulative chat totals' : null,
    `This chat: ${sessionTotal.toLocaleString()} tokens (input + output)`,
    `Input: ${inputTotal.toLocaleString()} · Output: ${outputTotal.toLocaleString()}`,
    cacheHitTokens > 0
      ? `Cache hit: ${cacheHitTokens.toLocaleString()} tokens`
      : null,
    estimate ? `Est. cost: ${formatUsd(estimate.totalUsd)}` : null,
    `Latest call: ${latestInput.toLocaleString()} in · ${latestOutput.toLocaleString()} out`,
    usage.contextWindow > 0
      ? `Model window: ${usage.contextWindow.toLocaleString()} tokens`
      : null,
    breakdown
      ? `Context fill: ${formatCompact(breakdown.totalTokens)} / ${formatCompact(breakdown.contextWindow)} (${formatPct(fillRatio)})`
      : null,
    `Model calls: ${usage.modelCalls} · Tools: ${usage.toolCalls}`,
    `Turns: ${usage.turnCount}`,
  ]
    .filter(Boolean)
    .join('\n');

  const toggle = () => setOpen((value) => !value);
  const placementClass = placement ? ` token-popover--${placement}` : '';
  const headerTag = usage.live
    ? 'Live'
    : breakdown?.source === 'prompt_budget'
      ? 'Budget'
      : usage.estimated
        ? 'Estimated'
        : reportedLabel;

  return (
    <div className={`token-meter-cluster${placementClass}`} ref={rootRef}>
      <div className={`token-popover${placementClass}`}>
        <button
          type="button"
          className={`token-chip${open ? ' token-chip--active' : ''}${usage.live ? ' token-chip--live' : ''}`}
          title={tooltip}
          aria-label="Chat token usage"
          aria-expanded={open}
          onClick={toggle}
        >
          {glyph ? (
            <span className="token-chip__glyph" aria-hidden="true">
              {glyph}
            </span>
          ) : null}
          {usage.live ? (
            <span className="token-chip__live" aria-label="Updating live" />
          ) : null}
          <span>{formatCompact(sessionTotal)}</span>
          <span className="token-chip__sep">·</span>
          <span
            className="token-chip__io"
            aria-label={`Input ${inputTotal.toLocaleString()} tokens, output ${outputTotal.toLocaleString()} tokens`}
          >
            <span aria-hidden="true">↑</span>
            <span>{formatCompact(inputTotal)}</span>
            <span aria-hidden="true">↓</span>
            <span>{formatCompact(outputTotal)}</span>
          </span>
          {breakdown && windowTokens > 0 ? (
            <>
              <span className="token-chip__sep">·</span>
              <span
                className="token-chip__ctx"
                aria-label={`Context ${formatPct(fillRatio)} of window`}
              >
                {formatPct(fillRatio)}
              </span>
            </>
          ) : null}
        </button>
        {open ? (
          <div
            className="token-popover__panel token-popover__panel--wide"
            role="dialog"
            aria-label="Token usage details"
          >
            <div className="token-popover__header">
              <span>
                {usage.live ? 'Live chat token monitor' : 'Chat token summary'}
              </span>
              <strong>{headerTag}</strong>
            </div>

            <ContextBudgetPanel
              breakdown={breakdown}
              windowTokens={windowTokens}
              live={usage.live}
            />

            {displayEstimate || showCacheSection ? (
              <CostAnalytics
                estimate={displayEstimate}
                showCacheSection={showCacheSection}
                cacheRatio={cacheRatio}
                cacheHitTokens={cacheHitTokens}
                cacheMissTokens={cacheMissTokens}
                inputTokensTotal={inputTotal}
              />
            ) : null}

            <UsageStats
              usage={usage}
              sessionTotal={sessionTotal}
              latestCall={latestCall}
              breakdown={breakdown}
              windowTokens={windowTokens}
              liveStatsLayout={liveStatsLayout}
            />
          </div>
        ) : null}
      </div>
      <CostCacheChips
        estimate={displayEstimate}
        cacheRatio={cacheRatio}
        cacheHitTokens={cacheHitTokens}
        showCacheUnavailable={Boolean(displayEstimate) && cacheRatio === null}
        open={open}
        live={usage.live}
        onToggle={toggle}
      />
    </div>
  );
}
