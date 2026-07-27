import type { IndexStatusSnapshot } from '../protocol';
import { IconButton } from './IconButton';
import { IconIndex } from './Icons';

interface IndexingStatusBarProps {
  index: IndexStatusSnapshot;
  onRefresh: () => void;
  onReindex: () => void;
}

type IndexTone = 'idle' | 'indexing' | 'ready' | 'warn';

const CAPABILITY_LABELS: Record<string, string> = {
  catalog: 'Catalog',
  codeIndex: 'Code',
  textIndex: 'Text',
  vectorIndex: 'Embeddings',
  graph: 'Graph',
  map: 'Map',
};

function resolveIndexTone(index: IndexStatusSnapshot): IndexTone {
  const message = (index.message ?? '').toLowerCase();
  const readiness = (index.readiness ?? '').toLowerCase();
  if (
    message.includes('indexing') ||
    message.includes('scanning') ||
    readiness === 'indexing' ||
    readiness === 'pending'
  ) {
    return 'indexing';
  }
  if (index.fileCount <= 0 && !readiness) return 'idle';
  if (readiness === 'unavailable' || readiness === 'degraded') return 'warn';
  if (index.fileCount > 0 || readiness) return 'ready';
  return 'idle';
}

function shortLabel(tone: IndexTone, index: IndexStatusSnapshot): string {
  switch (tone) {
    case 'indexing':
      return 'Indexing';
    case 'ready':
      return 'Indexed';
    case 'warn':
      return index.readiness === 'degraded' ? 'Degraded' : 'Unavailable';
    default:
      return 'Index';
  }
}

function detailTooltip(index: IndexStatusSnapshot): string {
  const parts: string[] = [];
  if (index.fileCount > 0) {
    parts.push(`${index.fileCount.toLocaleString()} files indexed`);
  }
  if (index.readiness) parts.push(`Readiness: ${index.readiness}`);
  if (index.scanCompleteness) parts.push(`Scan: ${index.scanCompleteness}`);
  if (index.indexMode) {
    parts.push(
      `Mode: ${index.indexMode === 'full' ? 'full code/text' : 'host snapshot'}`,
    );
  }
  for (const capability of index.capabilities ?? []) {
    const label =
      CAPABILITY_LABELS[capability.capability] ?? capability.capability;
    parts.push(`${label}: ${capability.status}`);
  }
  if (index.truncated) parts.push('Scan truncated');
  if (index.message) parts.push(index.message);
  if (index.lastIndexedAt) {
    parts.push(`Updated ${new Date(index.lastIndexedAt).toLocaleString()}`);
  }
  return parts.join(' · ') || 'Index workspace';
}

export function IndexingStatusBar({
  index,
  onRefresh,
  onReindex,
}: IndexingStatusBarProps) {
  const tone = resolveIndexTone(index);
  const label = shortLabel(tone, index);
  const tooltip = detailTooltip(index);

  return (
    <div
      className={`indexing-chip indexing-chip--${tone}`}
      title={tooltip}
    >
      <span className="indexing-chip__dot" aria-hidden="true" />
      <IconButton label="Refresh index status" variant="ghost" onClick={onRefresh}>
        <IconIndex width={14} height={14} />
      </IconButton>
      <button
        type="button"
        className="indexing-chip__label"
        onClick={onReindex}
        title={`${tooltip} — click to reindex`}
        aria-label={`${label}. ${tooltip}. Click to reindex.`}
      >
        {label}
      </button>
    </div>
  );
}
