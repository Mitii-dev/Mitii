import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type {
  ContextUsageBreakdown,
  ContextUsageNode,
} from '../shared/contextUsage.js';
import {
  estimateSessionCost,
  formatUsd,
  type ModelCostRates,
  type SessionCostEstimate,
} from '../shared/modelPricing.js';

export interface TokenUsageState {
  inputTokensTotal: number;
  outputTokensTotal: number;
  sessionTotal: number;
  modelCalls: number;
  toolCalls: number;
  turnCount: number;
  lastPromptTokens: number;
  lastResponseTokens: number;
  currentTurnTotal: number;
  contextWindow: number;
  /** Cumulative prompt-cache hits reported by the provider. */
  cacheHitTokens: number;
  /** Cumulative prompt-cache misses (full-rate input) when reported. */
  cacheMissTokens: number;
  live?: boolean;
  durationMs?: number;
  contextBreakdown?: ContextUsageBreakdown;
}

interface TokenMeterProps {
  usage: TokenUsageState;
  /** models.dev rates for the active profile; null hides the cost chip. */
  costRates?: ModelCostRates | null;
}

const CONTEXT_SLICE_COLORS: Record<string, string> = {
  output: '#9a6b6b',
  tools: '#777189',
  usable: '#5f6b77',
  repository: '#71806f',
  conversation: '#64748b',
  plan: '#6f8794',
  skills: '#8b7d6b',
  system: '#7c8794',
  free: '#9aa6b2',
  memory: '#6b7280',
  rules: '#7c8794',
};

function contextSliceColor(id: string): string {
  return CONTEXT_SLICE_COLORS[id] ?? '#8da2fb';
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatNodeMeta(node: ContextUsageNode, windowTokens: number): string {
  const allocated = node.allocatedTokens;
  if (node.kind === 'output' && allocated != null) {
    return `${formatCompact(allocated)} reserved · ${formatPct(allocated / Math.max(1, windowTokens))} of window`;
  }
  if (node.kind === 'free' && allocated != null) {
    return `${allocated.toLocaleString()} available`;
  }
  if (allocated != null && allocated > 0) {
    const used = node.usedTokens;
    return `${used.toLocaleString()} / ${allocated.toLocaleString()} · ${formatPct(used / allocated)} of budget`;
  }
  if (node.usedTokens > 0) {
    return `${node.usedTokens.toLocaleString()} · ${formatPct(node.usedTokens / Math.max(1, windowTokens))} of window`;
  }
  return '—';
}

function flattenTree(
  nodes: readonly ContextUsageNode[],
  depth = 0,
): Array<{ node: ContextUsageNode; depth: number }> {
  const rows: Array<{ node: ContextUsageNode; depth: number }> = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.children?.length) {
      rows.push(...flattenTree(node.children, depth + 1));
    }
  }
  return rows;
}

function topLevelSegments(
  tree: readonly ContextUsageNode[],
): Array<{ id: string; label: string; tokens: number }> {
  return tree
    .map((node) => ({
      id: node.id,
      label: node.label,
      tokens:
        node.kind === 'output'
          ? (node.allocatedTokens ?? 0)
          : Math.max(node.usedTokens, node.allocatedTokens ?? 0),
    }))
    .filter((entry) => entry.tokens > 0);
}

export function emptyTokenUsage(contextWindow = 0): TokenUsageState {
  return {
    inputTokensTotal: 0,
    outputTokensTotal: 0,
    sessionTotal: 0,
    modelCalls: 0,
    toolCalls: 0,
    turnCount: 0,
    lastPromptTokens: 0,
    lastResponseTokens: 0,
    currentTurnTotal: 0,
    contextWindow,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
  };
}

export function addTurnTokens(
  prev: TokenUsageState,
  input: number,
  output: number,
  cache?: { hit?: number; miss?: number },
): TokenUsageState {
  const inputTokensTotal = prev.inputTokensTotal + Math.max(0, input);
  const outputTokensTotal = prev.outputTokensTotal + Math.max(0, output);
  const cacheHitTokens =
    prev.cacheHitTokens + Math.max(0, cache?.hit ?? 0);
  const cacheMissTokens =
    prev.cacheMissTokens + Math.max(0, cache?.miss ?? 0);
  return {
    ...prev,
    inputTokensTotal,
    outputTokensTotal,
    sessionTotal: inputTokensTotal + outputTokensTotal,
    modelCalls: prev.modelCalls + 1,
    turnCount: prev.turnCount + 1,
    lastPromptTokens: Math.max(0, input),
    lastResponseTokens: Math.max(0, output),
    currentTurnTotal: Math.max(0, input) + Math.max(0, output),
    cacheHitTokens,
    cacheMissTokens,
    live: true,
  };
}

function cacheHitRatio(usage: TokenUsageState): number | null {
  const hit = usage.cacheHitTokens;
  const miss = usage.cacheMissTokens;
  if (hit <= 0 && miss <= 0) return null;
  const denom = hit + miss > 0 ? hit + miss : usage.inputTokensTotal;
  if (denom <= 0) return null;
  return Math.min(1, hit / denom);
}

function CostCacheChips(props: {
  estimate: SessionCostEstimate | null;
  cacheRatio: number | null;
  cacheHitTokens: number;
  /** Show a muted cache pill when cost is known but provider omits cache stats. */
  showCacheUnavailable?: boolean;
  open: boolean;
  live?: boolean;
  onToggle: () => void;
}) {
  const {
    estimate,
    cacheRatio,
    cacheHitTokens,
    showCacheUnavailable,
    open,
    live,
    onToggle,
  } = props;
  if (!estimate && cacheRatio === null && !showCacheUnavailable) return null;

  return (
    <div className="token-chip-group" role="group" aria-label="Cost and cache">
      {estimate ? (
        <button
          type="button"
          className={`token-chip token-chip--cost${open ? ' token-chip--active' : ''}${
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
          className={`token-chip token-chip--cache${open ? ' token-chip--active' : ''}`}
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
          className={`token-chip token-chip--cache-na${open ? ' token-chip--active' : ''}`}
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

export function TokenMeter({ usage, costRates = null }: TokenMeterProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const sessionTotal =
    usage.sessionTotal || usage.inputTokensTotal + usage.outputTokensTotal;
  const latestTotal = usage.lastPromptTokens + usage.lastResponseTokens;
  const breakdown = usage.contextBreakdown;
  const tree = breakdown?.tree;
  const treeRows = tree ? flattenTree(tree) : [];
  const segmentRows = tree
    ? topLevelSegments(tree)
    : (breakdown?.slices ?? [])
        .filter((slice) => slice.active && slice.tokens > 0)
        .map((slice) => ({
          id: slice.id,
          label: slice.label,
          tokens: slice.tokens,
        }));
  const segmentTotal = segmentRows.reduce((sum, row) => sum + row.tokens, 0);
  const fillRatio = breakdown?.fillRatio ?? 0;
  const windowTokens = breakdown?.contextWindow ?? usage.contextWindow;

  const estimate = useMemo(
    () =>
      estimateSessionCost(costRates, {
        inputTokens: usage.inputTokensTotal,
        outputTokens: usage.outputTokensTotal,
        cacheHitTokens: usage.cacheHitTokens,
        cacheMissTokens: usage.cacheMissTokens,
      }),
    [
      costRates,
      usage.inputTokensTotal,
      usage.outputTokensTotal,
      usage.cacheHitTokens,
      usage.cacheMissTokens,
    ],
  );
  const showCost =
    Boolean(estimate) &&
    (usage.sessionTotal > 0 ||
      usage.inputTokensTotal > 0 ||
      usage.outputTokensTotal > 0 ||
      Boolean(usage.live));
  const displayEstimate = showCost ? estimate : null;
  const cacheRatio = cacheHitRatio(usage);
  const showCacheSection =
    usage.cacheHitTokens > 0 ||
    usage.cacheMissTokens > 0 ||
    Boolean(displayEstimate?.usedCachePricing);

  const toggle = () => setOpen((value) => !value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
  }, [open]);

  return (
    <div className="token-meter-cluster" ref={popoverRef}>
      <div className="token-popover">
        <button
          type="button"
          className={`token-chip${open ? ' token-chip--active' : ''}${
            usage.live ? ' token-chip--live' : ''
          }`}
          aria-label="Chat token usage"
          aria-expanded={open}
          title={[
            `This chat: ${sessionTotal.toLocaleString()} tokens`,
            `↑ ${usage.inputTokensTotal.toLocaleString()} in · ↓ ${usage.outputTokensTotal.toLocaleString()} out`,
            usage.cacheHitTokens > 0
              ? `Cache hit ${usage.cacheHitTokens.toLocaleString()} tokens`
              : null,
            estimate
              ? `Est. cost ${formatUsd(estimate.totalUsd)}`
              : null,
            breakdown
              ? `Context: ${formatCompact(breakdown.totalTokens)} / ${formatCompact(breakdown.contextWindow)} (${formatPct(fillRatio)})`
              : null,
          ]
            .filter(Boolean)
            .join('\n')}
          onClick={toggle}
        >
          {usage.live ? (
            <span className="token-chip__live" aria-label="Updating live" />
          ) : null}
          <span>{formatCompact(sessionTotal)}</span>
          <span className="token-chip__sep">·</span>
          <span className="token-chip__io">
            <span aria-hidden>↑</span>
            <span>{formatCompact(usage.inputTokensTotal)}</span>
            <span aria-hidden>↓</span>
            <span>{formatCompact(usage.outputTokensTotal)}</span>
          </span>
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
              <strong>
                {usage.live
                  ? 'Live'
                  : breakdown?.source === 'prompt_budget'
                    ? 'Budget'
                    : 'Session'}
              </strong>
            </div>

            {(displayEstimate || showCacheSection) && (
              <section
                className="token-analytics"
                aria-label="Cost and cache analytics"
              >
                <div className="token-analytics__grid">
                  {displayEstimate ? (
                    <div className="token-stat-card token-stat-card--cost">
                      <div className="token-stat-card__label">
                        <span className="token-chip__dot token-chip__dot--cost" />
                        Est. cost
                      </div>
                      <div className="token-stat-card__value">
                        {formatUsd(displayEstimate.totalUsd)}
                      </div>
                      <div className="token-stat-card__meta">
                        models.dev · not billed
                      </div>
                    </div>
                  ) : null}
                  {displayEstimate ? (
                    <div className="token-stat-card">
                      <div className="token-stat-card__label">Input / out</div>
                      <div className="token-stat-card__value token-stat-card__value--split">
                        <span>{formatUsd(displayEstimate.inputUsd)}</span>
                        <span className="token-stat-card__sep">/</span>
                        <span>{formatUsd(displayEstimate.outputUsd)}</span>
                      </div>
                      <div className="token-stat-card__meta">
                        @ {displayEstimate.rates.input}/
                        {displayEstimate.rates.output} per 1M
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
                        {usage.cacheHitTokens > 0
                          ? `${formatCompact(usage.cacheHitTokens)} cached`
                          : 'Not reported by provider'}
                      </div>
                    </div>
                  ) : null}
                  {displayEstimate?.usedCachePricing ? (
                    <div className="token-stat-card token-stat-card--savings">
                      <div className="token-stat-card__label">Cache savings</div>
                      <div className="token-stat-card__value">
                        {formatUsd(displayEstimate.cacheSavingsUsd)}
                      </div>
                      <div className="token-stat-card__meta">
                        vs full input rate
                      </div>
                    </div>
                  ) : null}
                </div>

                {showCacheSection &&
                (usage.cacheHitTokens > 0 || usage.cacheMissTokens > 0) ? (
                  <div className="token-cache-bar" aria-label="Cache composition">
                    <div className="token-cache-bar__track">
                      {(() => {
                        const hit = usage.cacheHitTokens;
                        const miss =
                          usage.cacheMissTokens > 0
                            ? usage.cacheMissTokens
                            : Math.max(0, usage.inputTokensTotal - hit);
                        const total = hit + miss;
                        const hitShare = total > 0 ? hit / total : 0;
                        const missShare = total > 0 ? miss / total : 0;
                        return (
                          <>
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
                          </>
                        );
                      })()}
                    </div>
                    <div className="token-cache-bar__legend">
                      <span>
                        <i className="token-cache-bar__swatch token-cache-bar__swatch--hit" />
                        Hit {formatCompact(usage.cacheHitTokens)}
                      </span>
                      <span>
                        <i className="token-cache-bar__swatch token-cache-bar__swatch--miss" />
                        Miss{' '}
                        {formatCompact(
                          usage.cacheMissTokens > 0
                            ? usage.cacheMissTokens
                            : Math.max(
                                0,
                                usage.inputTokensTotal - usage.cacheHitTokens,
                              ),
                        )}
                      </span>
                    </div>
                  </div>
                ) : displayEstimate && !displayEstimate.usedCachePricing ? (
                  <div className="token-popover__summary token-popover__summary--note">
                    Provider did not report cache hits. Cost uses full input
                    rates (may overestimate when caching is active).
                  </div>
                ) : null}
              </section>
            )}

            <dl className="token-popover__stats token-popover__stats--primary">
              <div>
                <dt>Total tokens</dt>
                <dd>{sessionTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total sent</dt>
                <dd>{usage.inputTokensTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total received</dt>
                <dd>{usage.outputTokensTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Model calls</dt>
                <dd>{usage.modelCalls.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Tool calls</dt>
                <dd>{usage.toolCalls.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(usage.durationMs)}</dd>
              </div>
            </dl>

            <section className="token-call-card" aria-label="Latest model call">
              <div className="token-call-card__top">
                <span>Latest call</span>
                <strong>
                  {formatCompact(latestTotal || usage.currentTurnTotal)}
                </strong>
              </div>
              <div className="token-call-card__io">
                <div>
                  <span>Sent</span>
                  <strong>↑{usage.lastPromptTokens.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Received</span>
                  <strong>↓{usage.lastResponseTokens.toLocaleString()}</strong>
                </div>
              </div>
              <div className="token-call-card__meta">
                <span>
                  {usage.live ? 'Current run' : 'Last completed run'} ·{' '}
                  {formatCompact(usage.currentTurnTotal)} tokens
                </span>
                <span>Turns {usage.turnCount}</span>
              </div>
            </section>

            <dl className="token-popover__stats token-popover__stats--tiny">
              <div>
                <dt>Context window</dt>
                <dd>
                  {windowTokens > 0 ? formatCompact(windowTokens) : '—'}
                </dd>
              </div>
              <div>
                <dt>Window used</dt>
                <dd>{breakdown ? formatPct(fillRatio) : '—'}</dd>
              </div>
              <div>
                <dt>Context tokens</dt>
                <dd>
                  {breakdown ? breakdown.totalTokens.toLocaleString() : '—'}
                </dd>
              </div>
              <div>
                <dt>Turns</dt>
                <dd>{usage.turnCount.toLocaleString()}</dd>
              </div>
            </dl>

            {breakdown ? (
              <section
                className="token-source-panel"
                aria-label="Window budget tree"
              >
                <div className="token-popover__section-title">
                  <span>
                    {tree
                      ? usage.live
                        ? 'Window budget (live)'
                        : 'Final window budget'
                      : 'Context by source'}
                  </span>
                  <span className="token-popover__section-meta">
                    {formatCompact(breakdown.totalTokens)} /{' '}
                    {formatCompact(breakdown.contextWindow)} ·{' '}
                    {formatPct(fillRatio)}
                    {breakdown.source === 'prompt_budget' ? ' · engine' : ''}
                  </span>
                </div>
                <div
                  className="token-fill token-fill--segmented"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(fillRatio * 100)}
                  aria-label="Context window fill"
                >
                  {segmentRows.map((slice) => {
                    const share =
                      segmentTotal > 0 ? slice.tokens / segmentTotal : 0;
                    return (
                      <span
                        key={slice.id}
                        className="token-fill__segment"
                        title={`${slice.label}: ${slice.tokens.toLocaleString()} tokens`}
                        style={
                          {
                            '--token-slice-color': contextSliceColor(slice.id),
                            width: `${Math.max(2, share * 100)}%`,
                          } as CSSProperties
                        }
                      />
                    );
                  })}
                </div>
                {treeRows.length > 0 ? (
                  <ul className="token-context-slices token-context-slices--tree">
                    {treeRows.map(({ node, depth }) => {
                      const barBase =
                        node.allocatedTokens && node.allocatedTokens > 0
                          ? node.allocatedTokens
                          : Math.max(1, windowTokens);
                      const barShare =
                        node.kind === 'output'
                          ? (node.allocatedTokens ?? 0) /
                            Math.max(1, windowTokens)
                          : node.usedTokens / barBase;
                      const idle =
                        node.kind === 'free' ||
                        (node.usedTokens <= 0 &&
                          (node.allocatedTokens ?? 0) <= 0);
                      return (
                        <li
                          key={`${depth}:${node.id}`}
                          className={
                            idle
                              ? 'token-context-slice token-context-slice--idle'
                              : 'token-context-slice'
                          }
                          style={
                            {
                              '--token-slice-color': contextSliceColor(node.id),
                            } as CSSProperties
                          }
                        >
                          <div className="token-context-slice__label">
                            <span
                              className={
                                depth > 0
                                  ? 'token-context-slice__name token-context-slice__name--child'
                                  : 'token-context-slice__name'
                              }
                            >
                              {depth > 0 ? (
                                <span
                                  className="token-context-slice__branch"
                                  aria-hidden
                                >
                                  └{' '}
                                </span>
                              ) : null}
                              {node.label}
                            </span>
                            <span>{formatNodeMeta(node, windowTokens)}</span>
                          </div>
                          <div className="token-context-slice__track">
                            <div
                              className="token-context-slice__bar"
                              style={{
                                width: `${Math.min(100, Math.max(0, barShare * 100))}%`,
                              }}
                            />
                          </div>
                          {(node.omittedTokens ?? 0) > 0 ||
                          (node.truncatedTokens ?? 0) > 0 ? (
                            <div className="token-context-slice__note">
                              {(node.omittedTokens ?? 0) > 0
                                ? `${node.omittedTokens!.toLocaleString()} omitted`
                                : null}
                              {(node.omittedTokens ?? 0) > 0 &&
                              (node.truncatedTokens ?? 0) > 0
                                ? ' · '
                                : null}
                              {(node.truncatedTokens ?? 0) > 0
                                ? `${node.truncatedTokens!.toLocaleString()} truncated`
                                : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="token-context-slices">
                    {(breakdown.slices ?? []).map((slice) => {
                      const share =
                        breakdown.contextWindow > 0
                          ? slice.tokens / breakdown.contextWindow
                          : 0;
                      const inputShare =
                        breakdown.totalTokens > 0
                          ? slice.tokens / breakdown.totalTokens
                          : 0;
                      return (
                        <li
                          key={slice.id}
                          className={
                            slice.active && slice.tokens > 0
                              ? 'token-context-slice'
                              : 'token-context-slice token-context-slice--idle'
                          }
                          style={
                            {
                              '--token-slice-color': contextSliceColor(slice.id),
                            } as CSSProperties
                          }
                        >
                          <div className="token-context-slice__label">
                            <span>{slice.label}</span>
                            <span>
                              {slice.tokens > 0
                                ? `${slice.tokens.toLocaleString()} · ${formatPct(inputShare)}`
                                : '—'}
                            </span>
                          </div>
                          <div className="token-context-slice__track">
                            <div
                              className="token-context-slice__bar"
                              style={{
                                width: `${Math.min(100, share * 100)}%`,
                              }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ) : (
              <div className="token-popover__summary">
                Context breakdown (output, repository, conversation, …) appears
                once the run builds a prompt.
              </div>
            )}
          </div>
        ) : null}
      </div>
      <CostCacheChips
        estimate={displayEstimate}
        cacheRatio={cacheRatio}
        cacheHitTokens={usage.cacheHitTokens}
        showCacheUnavailable={Boolean(displayEstimate) && cacheRatio === null}
        open={open}
        live={usage.live}
        onToggle={toggle}
      />
    </div>
  );
}
