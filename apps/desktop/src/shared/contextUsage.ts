/**
 * Context-window breakdown for Desktop token meter (from `prompt_ready`).
 */

export interface ContextUsageSlice {
  id: string;
  label: string;
  tokens: number;
  active: boolean;
}

export interface ContextUsageNode {
  id: string;
  label: string;
  usedTokens: number;
  allocatedTokens?: number;
  omittedTokens?: number;
  truncatedTokens?: number;
  kind: 'output' | 'tools' | 'usable' | 'section' | 'source' | 'free';
  active: boolean;
  children?: ContextUsageNode[];
}

export interface ContextUsageBreakdown {
  slices: ContextUsageSlice[];
  tree?: ContextUsageNode[];
  totalTokens: number;
  contextWindow: number;
  fillRatio: number;
  estimated: boolean;
  source?: 'host_estimate' | 'prompt_budget';
  updatedAt?: string;
}

const SECTION_LABELS: Record<string, string> = {
  repository: 'Repository',
  conversation: 'Conversation',
  plan: 'Plan',
  skills: 'Skills',
  system: 'System / rules',
  rules: 'Rules',
  memory: 'Memory',
  tools: 'Tools',
  output: 'Output reserve',
};

interface PromptSection {
  section: string;
  allocatedTokens: number;
  usedTokens: number;
  omittedTokens: number;
  truncatedTokens: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sectionUsed(
  sections: PromptSection[],
  id: string,
): PromptSection | undefined {
  return sections.find((s) => s.section === id);
}

function sumUsed(sections: PromptSection[], ids: string[]): number {
  return ids.reduce(
    (sum, id) => sum + (sectionUsed(sections, id)?.usedTokens ?? 0),
    0,
  );
}

function sumAllocated(sections: PromptSection[], ids: string[]): number {
  return ids.reduce(
    (sum, id) => sum + (sectionUsed(sections, id)?.allocatedTokens ?? 0),
    0,
  );
}

function sectionNode(params: {
  id: string;
  label: string;
  usedTokens: number;
  allocatedTokens: number;
  omittedTokens?: number;
  truncatedTokens?: number;
}): ContextUsageNode {
  return {
    id: params.id,
    label: params.label,
    usedTokens: params.usedTokens,
    allocatedTokens: params.allocatedTokens,
    omittedTokens: params.omittedTokens,
    truncatedTokens: params.truncatedTokens,
    kind: 'section',
    active: params.usedTokens > 0 || params.allocatedTokens > 0,
  };
}

/** Build a VS Code–style window tree from a `prompt_ready` RunEvent. */
export function breakdownFromPromptReady(
  event: unknown,
): ContextUsageBreakdown | null {
  const e = asRecord(event);
  if (!e || e.type !== 'prompt_ready') return null;
  const budget = asRecord(e.budget);
  if (!budget) return null;

  const contextWindow = Math.max(
    1,
    typeof budget.contextWindowTokens === 'number'
      ? budget.contextWindowTokens
      : 0,
  );
  const outputReserved =
    typeof budget.outputReservedTokens === 'number'
      ? budget.outputReservedTokens
      : 0;
  const totalUsed =
    typeof budget.totalUsedTokens === 'number' ? budget.totalUsedTokens : 0;
  const inputBudget =
    typeof budget.inputBudgetTokens === 'number'
      ? budget.inputBudgetTokens
      : Math.max(0, contextWindow - outputReserved);

  const rawSections = Array.isArray(budget.sections) ? budget.sections : [];
  const sections: PromptSection[] = [];
  for (const raw of rawSections) {
    const s = asRecord(raw);
    if (!s || typeof s.section !== 'string') continue;
    sections.push({
      section: s.section,
      allocatedTokens:
        typeof s.allocatedTokens === 'number' ? s.allocatedTokens : 0,
      usedTokens: typeof s.usedTokens === 'number' ? s.usedTokens : 0,
      omittedTokens: typeof s.omittedTokens === 'number' ? s.omittedTokens : 0,
      truncatedTokens:
        typeof s.truncatedTokens === 'number' ? s.truncatedTokens : 0,
    });
  }

  const window = asRecord(e.window);
  const toolSchemaTokens =
    typeof window?.toolSchemaTokens === 'number'
      ? window.toolSchemaTokens
      : (sectionUsed(sections, 'tools')?.allocatedTokens ?? 0);
  const usableInputTokens =
    typeof window?.usableInputTokens === 'number'
      ? window.usableInputTokens
      : inputBudget;

  const repo = sectionUsed(sections, 'repository');
  const conversation = sectionUsed(sections, 'conversation');
  const plan = sectionUsed(sections, 'plan');
  const skills = sectionUsed(sections, 'skills');
  const tools = sectionUsed(sections, 'tools');
  const systemIds = ['system', 'rules', 'memory'];

  const repositoryAllocated =
    typeof window?.repositoryTokens === 'number'
      ? window.repositoryTokens
      : (repo?.allocatedTokens ?? 0);
  const conversationAllocated =
    typeof window?.conversationTokens === 'number'
      ? window.conversationTokens
      : (conversation?.allocatedTokens ?? 0);
  const planUsed =
    typeof window?.planUsedTokens === 'number'
      ? window.planUsedTokens
      : (plan?.usedTokens ?? 0);
  const planAllocated =
    planUsed > 0
      ? typeof window?.planTokens === 'number'
        ? window.planTokens
        : (plan?.allocatedTokens ?? 0)
      : 0;
  const skillsAllocated =
    typeof window?.skillsTokens === 'number'
      ? window.skillsTokens
      : (skills?.allocatedTokens ?? 0);
  const systemAllocated =
    typeof window?.systemTokens === 'number'
      ? window.systemTokens
      : sumAllocated(sections, systemIds);

  const repository = sectionNode({
    id: 'repository',
    label: 'Repository',
    usedTokens: repo?.usedTokens ?? 0,
    allocatedTokens: repositoryAllocated,
    omittedTokens: repo?.omittedTokens,
    truncatedTokens: repo?.truncatedTokens,
  });
  const conversationNode = sectionNode({
    id: 'conversation',
    label: 'Conversation',
    usedTokens: conversation?.usedTokens ?? 0,
    allocatedTokens: conversationAllocated,
    omittedTokens: conversation?.omittedTokens,
    truncatedTokens: conversation?.truncatedTokens,
  });
  const planNode = sectionNode({
    id: 'plan',
    label: 'Plan',
    usedTokens: planUsed,
    allocatedTokens: planAllocated,
  });
  const skillsNode = sectionNode({
    id: 'skills',
    label: 'Skills',
    usedTokens: skills?.usedTokens ?? 0,
    allocatedTokens: skillsAllocated,
    omittedTokens: skills?.omittedTokens,
  });
  const systemNode = sectionNode({
    id: 'system',
    label: 'System / rules',
    usedTokens: sumUsed(sections, systemIds),
    allocatedTokens: systemAllocated,
  });

  const sectionUsedTotal =
    repository.usedTokens +
    conversationNode.usedTokens +
    planNode.usedTokens +
    skillsNode.usedTokens +
    systemNode.usedTokens;
  const freeAllocated = Math.max(
    0,
    usableInputTokens -
      (repositoryAllocated +
        conversationAllocated +
        planAllocated +
        skillsAllocated +
        systemAllocated),
  );

  const usableChildren: ContextUsageNode[] = [
    repository,
    conversationNode,
    planNode,
    skillsNode,
    systemNode,
  ];
  if (freeAllocated > 0 || usableInputTokens > sectionUsedTotal) {
    usableChildren.push({
      id: 'free',
      label: 'Free / remainder',
      usedTokens: 0,
      allocatedTokens:
        freeAllocated > 0
          ? freeAllocated
          : Math.max(0, usableInputTokens - sectionUsedTotal),
      kind: 'free',
      active: false,
    });
  }

  const toolsNode: ContextUsageNode = {
    id: 'tools',
    label: 'Tools / schemas',
    usedTokens: tools?.usedTokens ?? 0,
    allocatedTokens: toolSchemaTokens,
    omittedTokens: tools?.omittedTokens,
    kind: 'tools',
    active: toolSchemaTokens > 0 || (tools?.usedTokens ?? 0) > 0,
  };

  const usableNode: ContextUsageNode = {
    id: 'usable',
    label: 'Usable input',
    usedTokens: sectionUsedTotal,
    allocatedTokens: usableInputTokens,
    kind: 'usable',
    active: true,
    children: usableChildren,
  };

  const outputNode: ContextUsageNode = {
    id: 'output',
    label: 'Output reserve',
    usedTokens: 0,
    allocatedTokens: outputReserved,
    kind: 'output',
    active: outputReserved > 0,
  };

  const tree: ContextUsageNode[] = [outputNode, toolsNode, usableNode];

  const slices: ContextUsageSlice[] = sections.map((s) => ({
    id: s.section,
    label: SECTION_LABELS[s.section] ?? s.section,
    tokens: s.usedTokens,
    active: s.usedTokens > 0 || s.allocatedTokens > 0,
  }));

  return {
    slices,
    tree,
    totalTokens: totalUsed,
    contextWindow,
    fillRatio: Math.min(1, totalUsed / contextWindow),
    estimated: false,
    source: 'prompt_budget',
    updatedAt: new Date().toISOString(),
  };
}
