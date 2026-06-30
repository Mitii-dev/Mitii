import { useState } from 'react';
import { ContextDebuggerPanel } from './ContextDebuggerPanel';
import { MemoryPanel } from './MemoryPanel';
import { CheckpointPanel } from './CheckpointPanel';
import type {
  ContextBudgetView,
  ContextItemView,
  MemoryItemView,
  CheckpointView,
  TokenUsageView,
} from '../../../vscode/webview/messages';

interface DevPanelsProps {
  contextBudget: ContextBudgetView | null;
  contextPreview: ContextItemView[];
  contextTokenEstimate: number;
  tokenUsage: TokenUsageView;
  memories: MemoryItemView[];
  checkpoints: CheckpointView[];
  onDeleteMemory: (id: number) => void;
  onClearMemory: () => void;
  onRestoreCheckpoint: (id: string) => void;
}

export function DevPanels({
  contextBudget,
  contextPreview,
  contextTokenEstimate,
  tokenUsage,
  memories,
  checkpoints,
  onDeleteMemory,
  onClearMemory,
  onRestoreCheckpoint,
}: DevPanelsProps) {
  const [contextExpanded, setContextExpanded] = useState(false);
  const [sideTab, setSideTab] = useState<'memory' | 'checkpoints'>('memory');

  return (
    <aside className="dev-panels" aria-label="Context, memory, and checkpoints">
      <ContextDebuggerPanel
        budget={contextBudget}
        items={contextPreview}
        totalTokens={contextTokenEstimate}
        lastRequestTokens={tokenUsage.lastPromptTokens}
        contextWindow={tokenUsage.contextWindow}
        expanded={contextExpanded}
        onToggle={() => setContextExpanded((v) => !v)}
      />

      <div className="dev-panels__tabs" role="tablist" aria-label="Side panels">
        <button
          type="button"
          role="tab"
          aria-selected={sideTab === 'memory'}
          className={`dev-panels__tab ${sideTab === 'memory' ? 'dev-panels__tab--active' : ''}`}
          onClick={() => setSideTab('memory')}
        >
          Memory ({memories.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sideTab === 'checkpoints'}
          className={`dev-panels__tab ${sideTab === 'checkpoints' ? 'dev-panels__tab--active' : ''}`}
          onClick={() => setSideTab('checkpoints')}
        >
          Checkpoints ({checkpoints.length})
        </button>
      </div>

      {sideTab === 'memory' ? (
        <MemoryPanel memories={memories} onDelete={onDeleteMemory} onClear={onClearMemory} />
      ) : (
        <CheckpointPanel checkpoints={checkpoints} onRestore={onRestoreCheckpoint} />
      )}
    </aside>
  );
}
