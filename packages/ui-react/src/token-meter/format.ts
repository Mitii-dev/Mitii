import type {
  TokenMeterContextNode,
  TokenMeterUsage,
} from './types.js';

/** Distinct enterprise palette for context sections (bar + legend). */
const CONTEXT_SLICE_COLORS: Record<string, string> = {
  system: '#64748b',
  rules: '#0f766e',
  skills: '#c2410c',
  memory: '#7c3aed',
  tools: '#4f46e5',
  conversation: '#e11d48',
  repository: '#059669',
  plan: '#0284c8',
  output: '#94a3b8',
  output_reserve: '#94a3b8',
  usable: '#475569',
  free: '#cbd5e1',
  prompt: '#64748b',
  pinned: '#0ea5e9',
  editor: '#6366f1',
  diagnostics: '#b91c1c',
  gitDiff: '#0d9488',
  repoMap: '#15803d',
  mcp: '#9333ea',
  depth: '#64748b',
  runtime: '#334155',
};

const FALLBACK_SLICE_COLOR = '#64748b';

export function contextSliceColor(id: string): string {
  return CONTEXT_SLICE_COLORS[id] ?? FALLBACK_SLICE_COLOR;
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function formatPct(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function formatNodeMeta(
  node: TokenMeterContextNode,
  windowTokens: number,
): string {
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

export function flattenTree(
  nodes: readonly TokenMeterContextNode[],
  depth = 0,
): Array<{ node: TokenMeterContextNode; depth: number }> {
  const rows: Array<{ node: TokenMeterContextNode; depth: number }> = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.children && node.children.length > 0) {
      rows.push(...flattenTree(node.children, depth + 1));
    }
  }
  return rows;
}

export function topLevelSegments(
  tree: readonly TokenMeterContextNode[],
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

/** Cache hit share (0–1), or null when the provider reported no cache counters. */
export function cacheHitRatio(
  usage: Pick<
    TokenMeterUsage,
    'cacheHitTokens' | 'cacheMissTokens' | 'inputTokensTotal'
  >,
): number | null {
  const hit = usage.cacheHitTokens ?? 0;
  const miss = usage.cacheMissTokens ?? 0;
  if (hit <= 0 && miss <= 0) return null;
  const denom = hit + miss > 0 ? hit + miss : usage.inputTokensTotal;
  if (denom <= 0) return null;
  return Math.min(1, hit / denom);
}
