import type { CSSProperties } from 'react';

import {
  contextSliceColor,
  flattenTree,
  formatCompact,
  formatNodeMeta,
  formatPct,
  topLevelSegments,
} from './format.js';
import type { TokenMeterBreakdown } from './types.js';

export interface ContextBudgetPanelProps {
  breakdown: TokenMeterBreakdown | undefined;
  windowTokens: number;
  live?: boolean;
}

function titleFor(
  breakdown: TokenMeterBreakdown,
  live: boolean | undefined,
): string {
  if (breakdown.tree) return live ? 'Window budget (live)' : 'Final window budget';
  return live ? 'Latest input by source' : 'Final context by source';
}

/** Window-budget tree (or flat host-source list) with a segmented fill bar. */
export function ContextBudgetPanel({
  breakdown,
  windowTokens,
  live,
}: ContextBudgetPanelProps) {
  if (!breakdown) {
    return (
      <div className="token-popover__summary token-popover__summary--start">
        <span>Context attribution will appear once the run builds a prompt.</span>
      </div>
    );
  }

  const tree = breakdown.tree;
  const treeRows = tree ? flattenTree(tree) : [];
  const segmentRows = tree
    ? topLevelSegments(tree)
    : (breakdown.slices ?? [])
        .filter((slice) => slice.active && slice.tokens > 0)
        .map((slice) => ({
          id: slice.id,
          label: slice.label,
          tokens: slice.tokens,
        }));
  const segmentTotal = segmentRows.reduce((sum, row) => sum + row.tokens, 0);
  const fillRatio = breakdown.fillRatio ?? 0;

  return (
    <section className="token-source-panel" aria-label="Window budget tree">
      <div className="token-popover__section-title token-popover__section-title--flush">
        <span>{titleFor(breakdown, live)}</span>
        <span className="token-popover__section-meta">
          {formatCompact(breakdown.totalTokens)} /{' '}
          {formatCompact(breakdown.contextWindow)} · {formatPct(fillRatio)}
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
          const share = segmentTotal > 0 ? slice.tokens / segmentTotal : 0;
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
              (node.usedTokens <= 0 && (node.allocatedTokens ?? 0) <= 0);
            const omitted = node.omittedTokens ?? 0;
            const truncated = node.truncatedTokens ?? 0;
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
                      <span className="token-context-slice__branch" aria-hidden>
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
                {omitted > 0 || truncated > 0 ? (
                  <div className="token-context-slice__note">
                    {omitted > 0 ? `${omitted.toLocaleString()} omitted` : null}
                    {omitted > 0 && truncated > 0 ? ' · ' : null}
                    {truncated > 0
                      ? `${truncated.toLocaleString()} truncated`
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
              breakdown.totalTokens > 0 ? slice.tokens / breakdown.totalTokens : 0;
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
                    style={{ width: `${Math.min(100, share * 100)}%` }}
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
  );
}
