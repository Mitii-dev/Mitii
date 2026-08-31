import type {
  ContextUsageBreakdown,
  ContextUsageNode,
  ContextUsageSlice,
  TokenBudgetPreview,
} from './protocol.js';

function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.max(0, Math.ceil(text.length / 4));
}

const REPOSITORY_SOURCE_IDS = new Set([
  'repoMap',
  'gitDiff',
  'pinned',
  'editor',
  'diagnostics',
]);

const SYSTEM_SOURCE_IDS = new Set(['prompt', 'depth']);

export interface PromptReadyBudgetSection {
  section: string;
  allocatedTokens: number;
  usedTokens: number;
  omittedTokens: number;
  truncatedTokens: number;
}

export interface PromptReadyBudget {
  contextWindowTokens: number;
  outputReservedTokens: number;
  inputBudgetTokens: number;
  totalUsedTokens: number;
  withinLimits: boolean;
  sections: PromptReadyBudgetSection[];
}

export interface PromptReadyWindow {
  toolSchemaTokens: number;
  usableInputTokens: number;
  repositoryTokens: number;
  conversationTokens: number;
  planTokens: number;
  planUsedTokens?: number;
  skillsTokens: number;
  systemTokens: number;
}

function sectionUsed(
  sections: readonly PromptReadyBudgetSection[] | undefined,
  id: string,
): PromptReadyBudgetSection | undefined {
  return sections?.find((entry) => entry.section === id);
}

function sumUsed(
  sections: readonly PromptReadyBudgetSection[] | undefined,
  ids: readonly string[],
): number {
  return ids.reduce((sum, id) => sum + (sectionUsed(sections, id)?.usedTokens ?? 0), 0);
}

function sumAllocated(
  sections: readonly PromptReadyBudgetSection[] | undefined,
  ids: readonly string[],
): number {
  return ids.reduce(
    (sum, id) => sum + (sectionUsed(sections, id)?.allocatedTokens ?? 0),
    0,
  );
}

function sourceNode(slice: ContextUsageSlice): ContextUsageNode {
  return {
    id: slice.id,
    label: slice.label,
    usedTokens: slice.tokens,
    kind: 'source',
    active: slice.active && slice.tokens > 0,
  };
}

function buildHostSlices(options: {
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
}): ContextUsageSlice[] {
  return [
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
}

function nestSources(
  slices: readonly ContextUsageSlice[],
  ids: ReadonlySet<string>,
): ContextUsageNode[] {
  return slices
    .filter((slice) => ids.has(slice.id))
    .map(sourceNode)
    .sort((a, b) => b.usedTokens - a.usedTokens || a.label.localeCompare(b.label));
}

function sectionNode(params: {
  id: string;
  label: string;
  usedTokens: number;
  allocatedTokens?: number;
  omittedTokens?: number;
  truncatedTokens?: number;
  children?: ContextUsageNode[];
}): ContextUsageNode {
  const childUsed = (params.children ?? []).reduce(
    (sum, child) => sum + child.usedTokens,
    0,
  );
  const usedTokens = Math.max(params.usedTokens, childUsed);
  return {
    id: params.id,
    label: params.label,
    usedTokens,
    allocatedTokens: params.allocatedTokens,
    omittedTokens: params.omittedTokens,
    truncatedTokens: params.truncatedTokens,
    kind: 'section',
    active: usedTokens > 0 || (params.allocatedTokens ?? 0) > 0,
    children: params.children,
  };
}

function buildWindowTree(params: {
  slices: readonly ContextUsageSlice[];
  contextWindow: number;
  outputReservedTokens: number;
  toolSchemaTokens: number;
  usableInputTokens: number;
  repositoryAllocated: number;
  conversationAllocated: number;
  planAllocated: number;
  skillsAllocated: number;
  systemAllocated: number;
  repositoryUsed: number;
  conversationUsed: number;
  planUsed: number;
  skillsUsed: number;
  systemUsed: number;
  toolsUsed: number;
  memoryUsed?: number;
  repositoryOmitted?: number;
  conversationOmitted?: number;
  skillsOmitted?: number;
  toolsOmitted?: number;
  repositoryTruncated?: number;
  conversationTruncated?: number;
}): ContextUsageNode[] {
  const repoChildren = nestSources(params.slices, REPOSITORY_SOURCE_IDS);
  const systemChildren = nestSources(params.slices, SYSTEM_SOURCE_IDS);
  const memorySlice = params.slices.find((slice) => slice.id === 'memory');
  if (memorySlice && (memorySlice.tokens > 0 || memorySlice.active)) {
    systemChildren.push(sourceNode(memorySlice));
  }
  const mcpSlice = params.slices.find((slice) => slice.id === 'mcp');
  const toolChildren =
    mcpSlice && (mcpSlice.tokens > 0 || mcpSlice.active)
      ? [sourceNode(mcpSlice)]
      : undefined;

  const conversationHost = params.slices.find((slice) => slice.id === 'conversation');
  const conversationUsed = Math.max(
    params.conversationUsed,
    conversationHost?.tokens ?? 0,
  );

  const repository = sectionNode({
    id: 'repository',
    label: 'Repository',
    usedTokens: params.repositoryUsed,
    allocatedTokens: params.repositoryAllocated,
    omittedTokens: params.repositoryOmitted,
    truncatedTokens: params.repositoryTruncated,
    children: repoChildren,
  });
  const conversation = sectionNode({
    id: 'conversation',
    label: 'Conversation',
    usedTokens: conversationUsed,
    allocatedTokens: params.conversationAllocated,
    omittedTokens: params.conversationOmitted,
    truncatedTokens: params.conversationTruncated,
  });
  const plan = sectionNode({
    id: 'plan',
    label: 'Plan',
    usedTokens: params.planUsed,
    allocatedTokens: params.planAllocated,
  });
  const skills = sectionNode({
    id: 'skills',
    label: 'Skills',
    usedTokens: params.skillsUsed,
    allocatedTokens: params.skillsAllocated,
    omittedTokens: params.skillsOmitted,
  });
  const system = sectionNode({
    id: 'system',
    label: 'System / rules',
    usedTokens: Math.max(params.systemUsed, params.memoryUsed ?? 0),
    allocatedTokens: params.systemAllocated,
    children: systemChildren,
  });

  const sectionUsedTotal =
    repository.usedTokens +
    conversation.usedTokens +
    plan.usedTokens +
    skills.usedTokens +
    system.usedTokens;
  const freeAllocated = Math.max(
    0,
    params.usableInputTokens -
      (params.repositoryAllocated +
        params.conversationAllocated +
        params.planAllocated +
        params.skillsAllocated +
        params.systemAllocated),
  );

  const usableChildren: ContextUsageNode[] = [
    repository,
    conversation,
    plan,
    skills,
    system,
  ];
  if (freeAllocated > 0 || params.usableInputTokens > sectionUsedTotal) {
    usableChildren.push({
      id: 'free',
      label: 'Free / remainder',
      usedTokens: 0,
      allocatedTokens:
        freeAllocated > 0
          ? freeAllocated
          : Math.max(0, params.usableInputTokens - sectionUsedTotal),
      kind: 'free',
      active: false,
    });
  }

  const toolsNode: ContextUsageNode = {
    id: 'tools',
    label: 'Tool schemas',
    usedTokens: Math.max(params.toolsUsed, toolChildren?.[0]?.usedTokens ?? 0),
    allocatedTokens: params.toolSchemaTokens,
    omittedTokens: params.toolsOmitted,
    kind: 'tools',
    active: params.toolSchemaTokens > 0 || params.toolsUsed > 0,
    children: toolChildren,
  };

  const usableNode: ContextUsageNode = {
    id: 'usable',
    label: 'Usable input',
    usedTokens: Math.min(
      params.usableInputTokens,
      usableChildren.reduce((sum, child) => sum + child.usedTokens, 0),
    ),
    allocatedTokens: params.usableInputTokens,
    kind: 'usable',
    active: params.usableInputTokens > 0,
    children: usableChildren,
  };

  return [
    {
      id: 'output',
      label: 'Output reserve',
      usedTokens: 0,
      allocatedTokens: params.outputReservedTokens,
      kind: 'output',
      active: params.outputReservedTokens > 0,
    },
    toolsNode,
    usableNode,
  ];
}

/**
 * Provisional host estimate before `prompt_ready` (and fallback when budget is absent).
 */
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
  /** Optional live window-budget preview for parent ceilings. */
  preview?: Pick<
    TokenBudgetPreview,
    | 'maximumOutputTokens'
    | 'toolSchemaTokens'
    | 'usableInputTokens'
    | 'repositoryTokens'
    | 'conversationTokens'
    | 'planTokens'
    | 'skillsTokens'
    | 'systemTokens'
  >;
}): ContextUsageBreakdown {
  const slices = buildHostSlices(options);
  const window = Math.max(1, options.contextWindow);
  const hostTotal = slices.reduce((sum, slice) => sum + slice.tokens, 0);

  const preview = options.preview;
  const outputReserved =
    preview?.maximumOutputTokens ?? Math.floor(window * 0.2);
  const toolSchemaTokens = preview?.toolSchemaTokens ?? 0;
  const usableInputTokens =
    preview?.usableInputTokens ??
    Math.max(0, window - outputReserved - toolSchemaTokens);

  const tree = buildWindowTree({
    slices,
    contextWindow: window,
    outputReservedTokens: outputReserved,
    toolSchemaTokens,
    usableInputTokens,
    repositoryAllocated: preview?.repositoryTokens ?? usableInputTokens,
    conversationAllocated: preview?.conversationTokens ?? 0,
    planAllocated: preview?.planTokens ?? 0,
    skillsAllocated: preview?.skillsTokens ?? 0,
    systemAllocated: preview?.systemTokens ?? 0,
    repositoryUsed: slices
      .filter((slice) => REPOSITORY_SOURCE_IDS.has(slice.id))
      .reduce((sum, slice) => sum + slice.tokens, 0),
    conversationUsed:
      slices.find((slice) => slice.id === 'conversation')?.tokens ?? 0,
    planUsed: 0,
    skillsUsed: 0,
    systemUsed: slices
      .filter((slice) => SYSTEM_SOURCE_IDS.has(slice.id) || slice.id === 'memory')
      .reduce((sum, slice) => sum + slice.tokens, 0),
    toolsUsed: slices.find((slice) => slice.id === 'mcp')?.tokens ?? 0,
  });

  return {
    slices,
    tree,
    totalTokens: hostTotal,
    contextWindow: window,
    fillRatio: Math.min(1, hostTotal / window),
    estimated: true,
    source: 'host_estimate',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Merge engine `prompt_ready` budget/window into a host breakdown (keeps host children).
 */
export function mergePromptBudgetIntoBreakdown(params: {
  host: ContextUsageBreakdown;
  budget: PromptReadyBudget;
  window?: PromptReadyWindow;
}): ContextUsageBreakdown {
  const { host, budget, window } = params;
  const sections = budget.sections;
  const contextWindow = Math.max(
    1,
    budget.contextWindowTokens || host.contextWindow,
  );

  const repositorySection = sectionUsed(sections, 'repository');
  const conversationSection = sectionUsed(sections, 'conversation');
  const skillsSection = sectionUsed(sections, 'skills');
  const toolsSection = sectionUsed(sections, 'tools');
  const systemIds = ['system', 'rules', 'memory'] as const;

  const outputReserved = budget.outputReservedTokens;
  const toolSchemaTokens =
    window?.toolSchemaTokens ??
    toolsSection?.allocatedTokens ??
    host.tree?.find((node) => node.id === 'tools')?.allocatedTokens ??
    0;
  const usableInputTokens =
    window?.usableInputTokens ??
    budget.inputBudgetTokens ??
    Math.max(0, contextWindow - outputReserved - toolSchemaTokens);

  const planSection = sectionUsed(sections, 'plan');
  const planUsed =
    window?.planUsedTokens ?? planSection?.usedTokens ?? 0;
  const planAllocated =
    planUsed > 0
      ? window?.planTokens ?? planSection?.allocatedTokens ?? 0
      : 0;

  const tree = buildWindowTree({
    slices: host.slices,
    contextWindow,
    outputReservedTokens: outputReserved,
    toolSchemaTokens,
    usableInputTokens,
    repositoryAllocated:
      window?.repositoryTokens ?? repositorySection?.allocatedTokens ?? 0,
    conversationAllocated:
      window?.conversationTokens ?? conversationSection?.allocatedTokens ?? 0,
    planAllocated,
    skillsAllocated: window?.skillsTokens ?? skillsSection?.allocatedTokens ?? 0,
    systemAllocated:
      window?.systemTokens ?? sumAllocated(sections, systemIds),
    repositoryUsed: repositorySection?.usedTokens ?? 0,
    conversationUsed: conversationSection?.usedTokens ?? 0,
    planUsed,
    skillsUsed: skillsSection?.usedTokens ?? 0,
    systemUsed: sumUsed(sections, systemIds),
    toolsUsed: toolsSection?.usedTokens ?? 0,
    memoryUsed: sectionUsed(sections, 'memory')?.usedTokens,
    repositoryOmitted: repositorySection?.omittedTokens,
    conversationOmitted: conversationSection?.omittedTokens,
    skillsOmitted: skillsSection?.omittedTokens,
    toolsOmitted: toolsSection?.omittedTokens,
    repositoryTruncated: repositorySection?.truncatedTokens,
    conversationTruncated: conversationSection?.truncatedTokens,
  });

  const totalTokens = budget.totalUsedTokens;
  return {
    slices: host.slices,
    tree,
    totalTokens,
    contextWindow,
    fillRatio: Math.min(1, totalTokens / contextWindow),
    estimated: false,
    source: 'prompt_budget',
    updatedAt: new Date().toISOString(),
  };
}
