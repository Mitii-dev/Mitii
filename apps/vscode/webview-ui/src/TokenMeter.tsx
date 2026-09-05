import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type { ContextUsageNode, TokenUsageSnapshot } from './protocol';
import { IconTokens } from './components/Icons';

interface TokenMeterProps {
  usage: TokenUsageSnapshot;
  placement?: 'above' | 'below';
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
  prompt: '#7c8794',
  pinned: '#8b949e',
  memory: '#6b7280',
  editor: '#707b87',
  diagnostics: '#9a6b6b',
  gitDiff: '#6f8794',
  repoMap: '#71806f',
  mcp: '#777189',
  depth: '#9aa6b2',
  runtime: '#5f6b77',
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
    const ofAlloc = formatPct(used / allocated);
    return `${used.toLocaleString()} / ${allocated.toLocaleString()} · ${ofAlloc} of budget`;
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
    if (node.children && node.children.length > 0) {
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
          ? node.allocatedTokens ?? 0
          : Math.max(node.usedTokens, node.allocatedTokens ?? 0),
    }))
    .filter((entry) => entry.tokens > 0);
}

export function TokenMeter({ usage, placement = 'above' }: TokenMeterProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputTotal = usage.inputTokensTotal;
  const outputTotal = usage.outputTokensTotal;
  const sessionTotal = usage.sessionTotal || inputTotal + outputTotal;
  const turns = usage.turns ?? [];
  const breakdown = usage.contextBreakdown;
  const latestCall = turns[turns.length - 1];
  const latestInput = latestCall?.inputTokens ?? usage.lastPromptTokens;
  const latestOutput = latestCall?.outputTokens ?? usage.lastResponseTokens;
  const latestTotal = latestInput + latestOutput;
  const liveCallLabel = latestCall
    ? `Call ${latestCall.turnIndex + 1}`
    : 'Latest call';
  const runTotal = usage.currentTurnTotal;
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

  const tooltip = [
    usage.live ? 'Live · updating cumulative chat totals' : null,
    `This chat: ${sessionTotal.toLocaleString()} tokens (input + output)`,
    `Input: ${inputTotal.toLocaleString()} · Output: ${outputTotal.toLocaleString()}`,
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
    <div
      className={`token-popover token-popover--${placement}`}
      ref={popoverRef}
    >
      <button
        type="button"
        className={`token-chip${open ? ' token-chip--active' : ''}${usage.live ? ' token-chip--live' : ''}`}
        title={tooltip}
        aria-label="Chat token usage"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="token-chip__glyph" aria-hidden="true">
          <IconTokens width={14} height={14} />
        </span>
        {usage.live ? (
          <span className="token-chip__live" aria-label="Live">
            live
          </span>
        ) : null}
        <span>{formatCompact(sessionTotal)}</span>
        <span className="token-chip__sep">·</span>
        <span
          className="token-chip__io"
          aria-label={
            `Input ${inputTotal.toLocaleString()} tokens, output ${outputTotal.toLocaleString()} tokens`
          }
        >
          <span aria-hidden="true">↑</span>
          <span>{formatCompact(inputTotal)}</span>
          <span aria-hidden="true">↓</span>
          <span>{formatCompact(outputTotal)}</span>
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
                  : usage.estimated
                    ? 'Estimated'
                    : 'Reported'}
            </strong>
          </div>

          {!usage.live ? (
            <dl className="token-popover__stats token-popover__stats--primary token-popover__stats--first">
              <div>
                <dt>Total tokens</dt>
                <dd>{sessionTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total sent</dt>
                <dd>{inputTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total received</dt>
                <dd>{outputTotal.toLocaleString()}</dd>
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
          ) : (
            <dl className="token-popover__stats token-popover__stats--primary token-popover__stats--compact token-popover__stats--first">
              <div>
                <dt>Chat total</dt>
                <dd>{sessionTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total sent</dt>
                <dd>{inputTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total received</dt>
                <dd>{outputTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Current run</dt>
                <dd>{formatCompact(runTotal)}</dd>
              </div>
            </dl>
          )}

          <section className="token-call-card" aria-label="Latest model call">
            <div className="token-call-card__top">
              <span>{liveCallLabel}</span>
              <strong>{formatCompact(latestTotal || usage.currentTurnTotal)}</strong>
            </div>
            <div className="token-call-card__io">
              <div>
                <span>Sent</span>
                <strong>↑{latestInput.toLocaleString()}</strong>
              </div>
              <div>
                <span>Received</span>
                <strong>↓{latestOutput.toLocaleString()}</strong>
              </div>
            </div>
            <div className="token-call-card__meta">
              <span>
                {usage.live ? 'Current run' : 'Last completed run'} ·{' '}
                {formatCompact(runTotal)} tokens
              </span>
              {latestCall?.finishReason ? <span>{latestCall.finishReason}</span> : null}
              {latestCall?.truncated ? <span>truncated</span> : null}
              {latestCall?.estimated || usage.estimated ? <span>estimated</span> : null}
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
              <dd>{breakdown ? breakdown.totalTokens.toLocaleString() : '—'}</dd>
            </div>
            <div>
              <dt>Turns</dt>
              <dd>{usage.turnCount.toLocaleString()}</dd>
            </div>
          </dl>

          {breakdown ? (
            <section className="token-source-panel" aria-label="Window budget tree">
              <div className="token-popover__section-title token-popover__section-title--flush">
                <span>
                  {tree
                    ? usage.live
                      ? 'Window budget (live)'
                      : 'Final window budget'
                    : usage.live
                      ? 'Latest input by source'
                      : 'Final context by source'}
                </span>
                <span className="token-popover__section-meta">
                  {formatCompact(breakdown.totalTokens)} /{' '}
                  {formatCompact(breakdown.contextWindow)} ·{' '}
                  {formatPct(fillRatio)}
                  {breakdown.estimated ? ' · est.' : ''}
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
                        ? (node.allocatedTokens ?? 0) / Math.max(1, windowTokens)
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
                            '--token-tree-depth': String(depth),
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
                              <span className="token-context-slice__branch" aria-hidden="true">
                                {'└ '.repeat(1)}
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
                <ul className="token-context-slices token-context-slices--monitor">
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
              {treeRows.length === 0 &&
              (breakdown.slices ?? []).every((s) => !s.active || s.tokens <= 0) ? (
                <div className="token-popover__summary token-popover__summary--start">
                  <span>No context slices attached yet.</span>
                </div>
              ) : null}
            </section>
          ) : (
            <div className="token-popover__summary token-popover__summary--start">
              <span>Context attribution will appear once the run builds a prompt.</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
