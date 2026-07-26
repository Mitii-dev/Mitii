import type { IndexingStatusView } from '../../../vscode/webview/messages';
import { IconButton } from './IconButton';
import { IconIndex, IconStop } from './Icons';

interface IndexingStatusBarProps {
  status: IndexingStatusView;
  onIndex: () => void;
  onCancel: () => void;
}

export function IndexingStatusBar({ status, onIndex, onCancel }: IndexingStatusBarProps) {
  const runTotal = status.runTotal ?? 0;
  const processed = Math.min(status.processed ?? 0, runTotal);
  const pct = runTotal > 0
    ? Math.round((processed / runTotal) * 100)
    : status.total > 0
      ? Math.round((status.indexed / status.total) * 100)
      : undefined;
  const busy = status.running || status.phase === 'scanning' || status.queued > 0;
  const label = status.running
    ? `Indexing… ${processed}/${runTotal || status.total} files${pct !== undefined ? ` · ${pct}%` : ''}`
    : status.phase === 'scanning'
      ? 'Scanning workspace…'
      : status.phase === 'cancelled'
        ? `${status.indexed}${status.total > 0 ? `/${status.total}` : ''} indexed · canceled`
    : status.indexed > 0
      ? `${status.indexed}${status.total > 0 ? `/${status.total}` : ''} indexed${status.failed > 0 ? ` · ${status.failed} failed` : ''}${status.partial || status.degraded ? ' · partial' : ''}`
      : 'Index workspace';
  const tooltip = status.detail || label;
  const progress = pct !== undefined ? Math.max(0, Math.min(100, pct)) : 0;

  return (
    <div className={`indexing-chip ${status.partial || status.degraded ? 'indexing-chip--degraded' : ''}`}>
      {busy && <span className="indexing-chip__pulse" aria-hidden="true" />}
      <IconButton
        label={tooltip}
        variant="ghost"
        onClick={onIndex}
        className="indexing-chip__btn"
      >
        <IconIndex width={14} height={14} />
      </IconButton>
      {busy && (
        <IconButton
          label="Cancel indexing"
          variant="ghost"
          onClick={onCancel}
          className="indexing-chip__btn"
        >
          <IconStop width={13} height={13} />
        </IconButton>
      )}
      <span className="indexing-chip__label">{label}</span>
      {busy && runTotal > 0 && (
        <span className="indexing-chip__progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      )}
    </div>
  );
}
