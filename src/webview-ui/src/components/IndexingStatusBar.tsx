import type { IndexingStatusView } from '../../../vscode/webview/messages';
import { IconButton } from './IconButton';
import { IconIndex } from './Icons';

interface IndexingStatusBarProps {
  status: IndexingStatusView;
  onIndex: () => void;
}

export function IndexingStatusBar({ status, onIndex }: IndexingStatusBarProps) {
  const pct =
    status.total > 0 ? Math.round((status.indexed / status.total) * 100) : undefined;
  const label = status.running
    ? `Indexing… ${status.queued} queued${pct !== undefined ? ` · ${pct}%` : ''}`
    : status.indexed > 0
      ? `${status.indexed}${status.total > 0 ? `/${status.total}` : ''} indexed${status.failed > 0 ? ` · ${status.failed} failed` : ''}`
      : 'Index workspace';

  return (
    <div className="indexing-chip">
      {status.running && <span className="indexing-chip__pulse" aria-hidden="true" />}
      <IconButton
        label={label}
        variant="ghost"
        onClick={onIndex}
        disabled={status.running}
        className="indexing-chip__btn"
      >
        <IconIndex width={14} height={14} />
      </IconButton>
    </div>
  );
}
