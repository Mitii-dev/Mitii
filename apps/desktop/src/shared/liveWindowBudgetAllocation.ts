import type { TokenBudgetPreview } from './liveTokenBudgetTypes.js';

export type WindowAllocationSliceId =
  | 'output'
  | 'tools'
  | 'repository'
  | 'conversation'
  | 'plan'
  | 'skills'
  | 'free';

export interface WindowAllocationSlice {
  id: WindowAllocationSliceId;
  label: string;
  tokens: number;
  windowShare: number;
}

const ALLOCATION_META: Array<{
  id: WindowAllocationSliceId;
  label: string;
  tokens: (preview: TokenBudgetPreview) => number;
}> = [
  {
    id: 'output',
    label: 'Output',
    tokens: (preview) => preview.maximumOutputTokens,
  },
  {
    id: 'tools',
    label: 'Tool schemas',
    tokens: (preview) => preview.toolSchemaTokens,
  },
  {
    id: 'repository',
    label: 'Repository',
    tokens: (preview) => preview.repositoryTokens,
  },
  {
    id: 'conversation',
    label: 'Conversation',
    tokens: (preview) => preview.conversationTokens,
  },
  { id: 'plan', label: 'Plan', tokens: (preview) => preview.planTokens },
  { id: 'skills', label: 'Skills', tokens: (preview) => preview.skillsTokens },
  {
    id: 'free',
    label: 'Free (unallocated)',
    tokens: (preview) => preview.systemTokens,
  },
];

export function windowAllocationSlices(
  preview: TokenBudgetPreview,
): WindowAllocationSlice[] {
  const windowTokens = Math.max(1, preview.contextWindowTokens);
  return ALLOCATION_META.map((entry) => {
    const tokens = Math.max(0, entry.tokens(preview));
    return {
      id: entry.id,
      label: entry.label,
      tokens,
      windowShare: tokens / windowTokens,
    };
  });
}
