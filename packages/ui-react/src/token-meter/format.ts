import type {
  TokenMeterContextNode,
  TokenMeterUsage,
} from './types.js';

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
  rules: '#7c8794',
  editor: '#707b87',
  diagnostics: '#9a6b6b',
  gitDiff: '#6f8794',
  repoMap: '#71806f',
  mcp: '#777189',
  depth: '#9aa6b2',
  runtime: '#5f6b77',
};

const FALLBACK_SLICE_COLOR = '#8da2fb';

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
