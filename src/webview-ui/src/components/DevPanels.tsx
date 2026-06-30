import { useState } from 'react';
import { ContextDebuggerPanel } from './ContextDebuggerPanel';
import type {
  ContextBudgetView,
  ContextItemView,
  TokenUsageView,
} from '../../../vscode/webview/messages';

interface DevPanelsProps {
  contextBudget: ContextBudgetView | null;
  contextPreview: ContextItemView[];
  contextTokenEstimate: number;
  tokenUsage: TokenUsageView;
}

export function DevPanels({
  contextBudget,
  contextPreview,
  contextTokenEstimate,
  tokenUsage,
}: DevPanelsProps) {
  const [contextExpanded, setContextExpanded] = useState(false);

  return (
    <aside className="dev-panels" aria-label="Context diagnostics">
      <ContextDebuggerPanel
        budget={contextBudget}
        items={contextPreview}
        totalTokens={contextTokenEstimate}
        lastRequestTokens={tokenUsage.lastPromptTokens}
        contextWindow={tokenUsage.contextWindow}
        expanded={contextExpanded}
        onToggle={() => setContextExpanded((v) => !v)}
      />
    </aside>
  );
}
