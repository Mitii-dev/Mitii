import type { ContextItem, ContextPack, ContextDropInfo } from './types';

const BUDGET_SPLITS = {
  workspaceOverview: 0.18,
  repoMap: 0.15,
  retrievedCode: 0.35,
  openDiff: 0.10,
  memory: 0.10,
  chat: 0.10,
  systemPlan: 0.20,
};

export class ContextBudgeter {
  budget(items: ContextItem[], maxTokens: number): ContextPack {
    const bySource = groupBySource(items);
    const budgeted: ContextItem[] = [];
    const dropped: ContextDropInfo[] = [];
    let truncatedCount = 0;

    const allocations: Array<{ source: string; budget: number }> = [
      { source: 'mentioned-files', budget: maxTokens * 0.30 },
      { source: 'indexed-file-search', budget: maxTokens * 0.20 },
      { source: 'workspace-overview', budget: maxTokens * 0.22 },
      { source: 'repo-map', budget: maxTokens * BUDGET_SPLITS.repoMap },
      { source: 'fts', budget: maxTokens * BUDGET_SPLITS.retrievedCode * 0.6 },
      { source: 'current-editor', budget: maxTokens * BUDGET_SPLITS.openDiff * 0.5 },
      { source: 'open-files', budget: maxTokens * BUDGET_SPLITS.openDiff * 0.3 },
      { source: 'git-diff', budget: maxTokens * BUDGET_SPLITS.openDiff * 0.2 },
      { source: 'diagnostics', budget: maxTokens * BUDGET_SPLITS.openDiff * 0.2 },
      { source: 'memory', budget: maxTokens * BUDGET_SPLITS.memory },
    ];

    const includedIds = new Set<string>();

    for (const { source, budget } of allocations) {
      const sourceItems = bySource.get(source) ?? [];
      let used = 0;
      for (const item of sourceItems) {
        const remaining = Math.floor(budget - used);
        if (remaining <= 0) {
          dropped.push(dropEntry(item, 'over_budget'));
          continue;
        }

        if (item.tokenEstimate <= remaining) {
          budgeted.push(item);
          includedIds.add(item.id);
          used += item.tokenEstimate;
          continue;
        }

        const truncated = truncateItemToBudget(item, remaining);
        if (truncated) {
          budgeted.push(truncated);
          includedIds.add(truncated.id);
          used += truncated.tokenEstimate;
          truncatedCount += 1;
        } else {
          dropped.push(dropEntry(item, 'over_budget'));
        }
        break;
      }
    }

    for (const item of items) {
      if (!includedIds.has(item.id) && !dropped.some((d) => d.relPath === item.relPath && d.source === item.source)) {
        dropped.push(dropEntry(item, 'not_selected'));
      }
    }

    const totalTokens = budgeted.reduce((sum, i) => sum + i.tokenEstimate, 0);
    return {
      items: budgeted,
      totalTokens,
      formatted: formatContextPack(budgeted),
      retrievedCount: items.length,
      budgetLimit: maxTokens,
      dropped,
      truncatedCount,
    };
  }
}

function dropEntry(item: ContextItem, cause: ContextDropInfo['cause']): ContextDropInfo {
  return {
    source: item.source,
    relPath: item.relPath,
    reason: item.reason,
    tokenEstimate: item.tokenEstimate,
    cause,
  };
}

function truncateItemToBudget(item: ContextItem, maxTokens: number): ContextItem | undefined {
  if (maxTokens <= 0) return undefined;

  const maxChars = Math.max(1, maxTokens * 4);
  const content = item.content.length > maxChars
    ? `${item.content.slice(0, maxChars).trimEnd()}\n[truncated]`
    : item.content;
  const tokenEstimate = Math.min(maxTokens, Math.ceil(content.length / 4));

  return {
    ...item,
    id: `${item.id}-truncated`,
    content,
    tokenEstimate,
    reason: `${item.reason} (truncated to fit context budget)`,
  };
}

function groupBySource(items: ContextItem[]): Map<string, ContextItem[]> {
  const map = new Map<string, ContextItem[]>();
  for (const item of items) {
    const list = map.get(item.source) ?? [];
    list.push(item);
    map.set(item.source, list);
  }
  return map;
}

export function formatContextPack(items: ContextItem[]): string {
  return items
    .map((item) => `<!-- ${item.reason} -->\n${item.relPath ? `File: ${item.relPath}\n` : ''}${item.content}`)
    .join('\n\n---\n\n');
}
