import type { IndexStatusSnapshot } from '../protocol.js';

export interface RepositoryCapabilitySnapshot {
  capability: string;
  status: string;
  reasonCode?: string;
}

export interface RepositoryRootSnapshot {
  rootId: string;
  projectCatalogRevision: string;
  codeIndexRevision?: string;
  textIndexRevision?: string;
  vectorProfile?: string;
  vectorIndexRevision?: string;
  graphRevision?: string;
  mapRevision?: string;
  capabilities: RepositoryCapabilitySnapshot[];
}

export interface RepositoryDescriptorSnapshot {
  workspaceId: string;
  stateToken: string;
  readiness: string;
  scanCompleteness: string;
  cleanupAllowed: boolean;
  generatedAt: string;
  roots: RepositoryRootSnapshot[];
}

export type PersistedIndexState = RepositoryDescriptorSnapshot & {
  fileCount?: number;
  truncated?: boolean;
  indexMode?: IndexStatusSnapshot['indexMode'];
  reasons?: Array<{ message?: string }>;
};

export function capabilityRevision(
  root: RepositoryRootSnapshot,
  capability: string,
): string | undefined {
  switch (capability) {
    case 'codeIndex':
      return root.codeIndexRevision;
    case 'textIndex':
      return root.textIndexRevision;
    case 'vectorIndex':
      return root.vectorIndexRevision;
    case 'graph':
      return root.graphRevision;
    case 'map':
      return root.mapRevision;
    case 'catalog':
      return root.projectCatalogRevision;
    default:
      return undefined;
  }
}

export function indexStatusFromDescriptor(
  descriptor: RepositoryDescriptorSnapshot,
): Partial<IndexStatusSnapshot> {
  return {
    readiness: descriptor.readiness,
    scanCompleteness: descriptor.scanCompleteness,
    cleanupAllowed: descriptor.cleanupAllowed,
    rootCount: descriptor.roots.length,
    stateTokenPreview: descriptor.stateToken?.slice(0, 16),
    lastIndexedAt: descriptor.generatedAt,
    capabilities: descriptor.roots.flatMap((root) =>
      root.capabilities.map((entry) => ({
        rootId: root.rootId,
        capability: entry.capability,
        status: entry.status,
        reasonCode: entry.reasonCode,
        revision: capabilityRevision(root, entry.capability),
        profile:
          entry.capability === 'vectorIndex' ? root.vectorProfile : undefined,
      })),
    ),
  };
}

export function needsFullIndexRefresh(index: IndexStatusSnapshot): boolean {
  if (index.indexMode === 'host_snapshot') return true;
  const capabilities = index.capabilities ?? [];
  if (capabilities.length === 0) return false;
  const core = new Set(['codeIndex', 'textIndex', 'graph', 'map']);
  for (const capability of core) {
    if (
      !capabilities.some(
        (entry) =>
          entry.capability === capability && entry.status === 'ready',
      )
    ) {
      return true;
    }
  }
  return false;
}
