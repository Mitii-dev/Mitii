import type { IndexStatusSnapshot } from '../protocol';
import { IconFolder } from './Icons';

interface IndexingStatusBarProps {
  index: IndexStatusSnapshot;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

/** Status tones map to folder color: green / orange / red (+ idle muted). */
export type IndexTone = 'idle' | 'indexing' | 'ready' | 'warn';

const CAPABILITY_LABELS: Record<string, string> = {
  catalog: 'Catalog',
  codeIndex: 'Code',
  textIndex: 'Text',
  vectorIndex: 'Embeddings',
  graph: 'Graph',
  map: 'Map',
};

export function resolveIndexTone(index: IndexStatusSnapshot): IndexTone {
  const message = (index.message ?? '').toLowerCase();
  const readiness = (index.readiness ?? '').toLowerCase();
  const capabilities = index.capabilities ?? [];
  const requiredCapabilities = capabilities.filter((capability) =>
    ['catalog', 'codeIndex', 'textIndex', 'graph', 'map'].includes(
      capability.capability,
    ),
  );
  const missingRequired = requiredCapabilities.some(
    (capability) => capability.status !== 'ready',
  );
  const vectorDegraded = capabilities.some(
    (capability) =>
      capability.capability === 'vectorIndex' &&
      capability.status === 'degraded',
  );
  if (
    message.includes('indexing') ||
    message.includes('scanning') ||
    readiness === 'indexing' ||
    readiness === 'pending'
  ) {
    return 'indexing';
  }
  if (index.fileCount <= 0 && !readiness) return 'idle';
  const coreReady =
    requiredCapabilities.length > 0 &&
    requiredCapabilities.every((capability) => capability.status === 'ready');
  if (missingRequired || readiness === 'unavailable' || readiness === 'degraded') {
    return 'warn';
  }
  if (vectorDegraded) return 'warn';
  if (coreReady) return 'ready';
  if (index.fileCount > 0 || readiness) return 'ready';
  return 'idle';
}

/** Enterprise folder colors: green ready, orange in-progress, red issue. */
export function indexToneFolderColor(tone: IndexTone): string {
  switch (tone) {
    case 'ready':
      return '#3ecf8e';
    case 'indexing':
      return '#f0a020';
    case 'warn':
      return '#ef5f67';
    default:
      return 'muted';
  }
}

function shortLabel(tone: IndexTone, index: IndexStatusSnapshot): string {
  switch (tone) {
    case 'indexing':
      return (index.message ?? '').toLowerCase().includes('checking')
        ? 'Checking'
        : 'Indexing';
    case 'ready':
      return 'Indexed';
    case 'warn':
      return index.capabilities?.some(
        (capability) =>
          ['codeIndex', 'textIndex', 'graph', 'map'].includes(
            capability.capability,
          ) && capability.status !== 'ready',
      )
        ? 'Index Issue'
        : index.capabilities?.some(
              (capability) =>
                capability.capability === 'vectorIndex' &&
                capability.status === 'degraded',
            )
          ? 'Embeddings'
          : index.readiness === 'degraded'
            ? 'Degraded'
            : 'Unavailable';
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
    parts.push(
      capability.capability === 'vectorIndex' && capability.status === 'degraded'
        ? `${label}: degraded — reindex to restore semantic search`
        : `${label}: ${capability.status}`,
    );
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
  onOpenSettings,
}: IndexingStatusBarProps) {
  const tone = resolveIndexTone(index);
  const label = shortLabel(tone, index);
  const tooltip = detailTooltip(index);

  return (
    <button
      type="button"
      className={`indexing-chip indexing-chip--${tone}`}
      onClick={onOpenSettings}
      onDoubleClick={onRefresh}
      title={`${tooltip} — click for index settings · double-click to refresh`}
      aria-label={`${label}. ${tooltip}. Open index settings.`}
    >
      <IconFolder width={15} height={15} />
    </button>
  );
}
