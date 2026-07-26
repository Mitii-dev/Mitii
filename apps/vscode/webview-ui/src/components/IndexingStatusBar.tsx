import type { IndexStatusSnapshot } from '../protocol';
import { IconButton } from './IconButton';
import { IconIndex } from './Icons';

interface IndexingStatusBarProps {
  index: IndexStatusSnapshot;
  onRefresh: () => void;
  onReindex: () => void;
}

export function IndexingStatusBar({
  index,
  onRefresh,
  onReindex,
}: IndexingStatusBarProps) {
  const label =
    index.fileCount > 0
      ? `${index.fileCount} indexed${index.truncated ? ' · truncated' : ''}${index.readiness ? ` · ${index.readiness}` : ''}`
      : index.message ?? 'Index workspace';

  return (
    <div className="indexing-chip" title={index.message ?? label}>
      <IconButton label="Refresh index status" variant="ghost" onClick={onRefresh}>
        <IconIndex width={14} height={14} />
      </IconButton>
      <button type="button" className="indexing-chip__label" onClick={onReindex}>
        {label}
      </button>
    </div>
  );
}
