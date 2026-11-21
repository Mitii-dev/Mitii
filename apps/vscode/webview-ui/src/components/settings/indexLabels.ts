import { type IndexStatusSnapshot } from '../../protocol';

export const INDEX_CAPABILITY_LABELS: Record<string, string> = {
  catalog: 'Catalog',
  codeIndex: 'Code index',
  textIndex: 'Text index',
  vectorIndex: 'Embeddings',
  graph: 'Graph',
  map: 'Repo map',
};

export function displayCapabilityStatus(capability: {
  capability: string;
  status: string;
  reasonCode?: string;
}): { className: string; label: string } {
  if (capability.capability === 'vectorIndex') {
    if (capability.status === 'unavailable') {
      return { className: 'optional', label: 'not configured' };
    }
    if (capability.status === 'degraded') {
      return { className: 'degraded', label: 'degraded — reindex' };
    }
  }
  return { className: capability.status, label: capability.status };
}

export function formatIndexMode(mode: IndexStatusSnapshot['indexMode']): string {
  if (mode === 'full') return 'Full code/text index';
  if (mode === 'host_snapshot') return 'Host snapshot fallback';
  return 'Unknown';
}

export function capabilityDetails(index: IndexStatusSnapshot) {
  return [...(index.capabilities ?? [])].sort((a, b) => {
    const left = `${a.rootId ?? ''}:${a.capability}`;
    const right = `${b.rootId ?? ''}:${b.capability}`;
    return left.localeCompare(right);
  });
}
