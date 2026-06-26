import type { ContextItemView, ContextBudgetView } from '../../../vscode/webview/messages';

interface ContextPreviewProps {
  items: ContextItemView[];
  totalTokens: number;
  budget: ContextBudgetView | null;
  visible: boolean;
  onToggle: () => void;
}

export function ContextPreview({ items, totalTokens, budget, visible, onToggle }: ContextPreviewProps) {
  const usagePct = budget && budget.budgetLimit > 0
    ? Math.round((budget.usedTokens / budget.budgetLimit) * 100)
    : 0;

  return (
    <div className="context-preview">
      <button type="button" className="context-preview__toggle" onClick={onToggle}>
        Context {visible ? '▾' : '▸'} — {items.length} items, ~{totalTokens} tokens
        {budget && (
          <span className="context-preview__budget">
            {' '}· {budget.usedTokens}/{budget.budgetLimit}t ({usagePct}%)
            {budget.truncatedCount > 0 && ` · ${budget.truncatedCount} truncated`}
            {budget.dropped.length > 0 && ` · ${budget.dropped.length} dropped`}
          </span>
        )}
      </button>
      {visible && (
        <>
          {budget && (
            <div className="context-budget-summary">
              <p>
                Retrieved <strong>{budget.retrievedCount}</strong> items → included{' '}
                <strong>{budget.includedCount}</strong> in prompt ({budget.usedTokens}/
                {budget.budgetLimit} token budget)
              </p>
              {budget.dropped.length > 0 && (
                <details className="context-dropped">
                  <summary>{budget.dropped.length} items dropped (spillage)</summary>
                  <ul>
                    {budget.dropped.map((d, i) => (
                      <li key={`${d.source}-${d.relPath ?? i}`}>
                        <code>{d.relPath ?? d.source}</code> — {d.tokenEstimate}t ({d.cause})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {items.length > 0 && (
            <ul className="context-preview__list">
              {items.map((item) => (
                <li key={item.id} className="context-preview__item">
                  <div className="context-preview__meta">
                    <span className="context-preview__source">{item.source}</span>
                    {item.relPath && <span className="context-preview__path">{item.relPath}</span>}
                    <span className="context-preview__tokens">{item.tokenEstimate}t</span>
                    {item.truncated && <span className="context-preview__truncated">truncated</span>}
                  </div>
                  <p className="context-preview__reason">{item.reason}</p>
                  <pre className="context-preview__snippet">{item.preview}</pre>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
