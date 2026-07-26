import type { ContextBudgetView, IndexingStatusView } from '../../../vscode/webview/messages';

interface ContextWarningBannerProps {
  budget: ContextBudgetView | null;
  indexing: IndexingStatusView;
  onDismiss?: () => void;
}

export function ContextWarningBanner({ budget, indexing, onDismiss }: ContextWarningBannerProps) {
  const dropped = budget?.dropped.length ?? 0;
  const indexPct =
    indexing.total > 0 ? Math.round((indexing.indexed / indexing.total) * 100) : 100;
  const indexIncomplete = indexing.total > 0 && indexPct < 90;
  const degradedUsable = Boolean(indexing.partial || indexing.degraded || indexing.phase === 'cancelled');

  if (dropped === 0 && !indexIncomplete && !degradedUsable) return null;

  const messages: string[] = [];
  if (dropped > 0) {
    messages.push(
      `${dropped} relevant snippet${dropped === 1 ? '' : 's'} dropped from context — pin files or increase the model context window.`
    );
  }
  if (indexIncomplete) {
    messages.push(`Indexing ${indexPct}% - context may be incomplete until indexing finishes.`);
  } else if (degradedUsable) {
    messages.push(indexing.detail || 'The index is degraded but usable. Results may miss files that have not been indexed yet.');
  }

  return (
    <div className="context-warning-banner" role="status">
      <div className="context-warning-banner__text">
        {messages.map((msg) => (
          <p key={msg}>{msg}</p>
        ))}
      </div>
      {onDismiss && (
        <button type="button" className="context-warning-banner__dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
