import type { PlanView, ContextItemView, ContextBudgetView } from '../../../vscode/webview/messages';
import { PlanPanel } from './PlanPanel';
import { ContextPreview } from './ContextPreview';
import { SubagentStatusPanel } from './SubagentStatusPanel';
import type { SubagentStatusView } from '../../../vscode/webview/messages';

interface AgentDrawerProps {
  loading: boolean;
  plan: PlanView | null;
  subagents: SubagentStatusView[];
  contextPreview: ContextItemView[];
  contextTokenEstimate: number;
  contextBudget: ContextBudgetView | null;
  showContextPreview: boolean;
  onToggleContext: () => void;
}

export function AgentDrawer({
  loading,
  plan,
  subagents,
  contextPreview,
  contextTokenEstimate,
  contextBudget,
  showContextPreview,
  onToggleContext,
}: AgentDrawerProps) {
  const hasPlan = Boolean(plan);
  const hasContext = contextPreview.length > 0;

  const hasSubagents = subagents.length > 0;

  if (!hasPlan && !hasContext && !hasSubagents) return null;

  return (
    <div className="agent-drawer">
      <PlanPanel plan={plan} loading={loading} />
      <SubagentStatusPanel subagents={subagents} loading={loading} />
      <ContextPreview
        items={contextPreview}
        totalTokens={contextTokenEstimate}
        budget={contextBudget}
        visible={showContextPreview}
        onToggle={onToggleContext}
      />
    </div>
  );
}
