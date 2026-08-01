import type { ContextUsageBreakdown, ContextUsageSlice } from './protocol.js';

function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.max(0, Math.ceil(text.length / 4));
}

export function buildContextUsageBreakdown(options: {
  prompt: string;
  conversationText?: string;
  pinnedContents?: string;
  memoryBlock?: string;
  editorBlock?: string;
  diagnosticsBlock?: string;
  gitDiffBlock?: string;
  repoMapBlock?: string;
  mcpToolsCatalogTokens?: number;
  depthHint?: string;
  contextWindow: number;
}): ContextUsageBreakdown {
  const slices: ContextUsageSlice[] = [
    {
      id: 'prompt',
      label: 'Prompt',
      tokens: estimateTokens(options.prompt),
      active: Boolean(options.prompt.trim()),
    },
    {
      id: 'conversation',
      label: 'Conversation',
      tokens: estimateTokens(options.conversationText),
      active: Boolean(options.conversationText?.trim()),
    },
    {
      id: 'pinned',
      label: 'Pinned files',
      tokens: estimateTokens(options.pinnedContents),
      active: Boolean(options.pinnedContents?.trim()),
    },
    {
      id: 'memory',
      label: 'Memory',
      tokens: estimateTokens(options.memoryBlock),
      active: Boolean(options.memoryBlock?.trim()),
    },
    {
      id: 'editor',
      label: 'Editor',
      tokens: estimateTokens(options.editorBlock),
      active: Boolean(options.editorBlock?.trim()),
    },
    {
      id: 'diagnostics',
      label: 'Diagnostics',
      tokens: estimateTokens(options.diagnosticsBlock),
      active: Boolean(options.diagnosticsBlock?.trim()),
    },
    {
      id: 'gitDiff',
      label: 'Git diff',
      tokens: estimateTokens(options.gitDiffBlock),
      active: Boolean(options.gitDiffBlock?.trim()),
    },
    {
      id: 'repoMap',
      label: 'Repomap',
      tokens: estimateTokens(options.repoMapBlock),
      active: Boolean(options.repoMapBlock?.trim()),
    },
    {
      id: 'mcp',
      label: 'MCP tools',
      tokens: options.mcpToolsCatalogTokens ?? 0,
      active: (options.mcpToolsCatalogTokens ?? 0) > 0,
    },
    {
      id: 'depth',
      label: 'Depth hint',
      tokens: estimateTokens(
        options.depthHint && options.depthHint !== 'auto'
          ? `[depth:${options.depthHint}]`
          : '',
      ),
      active: Boolean(options.depthHint && options.depthHint !== 'auto'),
    },
  ];

  const totalTokens = slices.reduce((sum, s) => sum + s.tokens, 0);
  const window = Math.max(1, options.contextWindow);
  return {
    slices,
    totalTokens,
    contextWindow: window,
    fillRatio: Math.min(1, totalTokens / window),
    estimated: true,
    updatedAt: new Date().toISOString(),
  };
}
