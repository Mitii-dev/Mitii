import {
  formatIndexPipelineHealthLines,
  readIndexPipelineHealth,
} from '@mitii/host';

import type { SessionIo } from '../session.js';

export type RepositoryCapabilitySummary = Array<{
  rootId: string;
  capability: string;
  status: string;
  reasonCode?: string;
  revision?: string;
  profile?: string;
}>;

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

export interface IndexingDiagnostics {
  status: string;
  cleanupAllowed: boolean;
  statistics: unknown;
  warnings: unknown[];
  rootResults: unknown[];
  incompleteFiles: Array<{
    path: string;
    status: string;
    analysisStatus?: string;
    chunkingStatus?: string;
    codeIndexStatus?: string;
    textIndexStatus?: string;
    warnings: unknown[];
  }>;
}

export interface IndexingFileResultSnapshot {
  relativePath: string;
  status: string;
  analysisStatus?: string;
  chunkingStatus?: string;
  codeIndexStatus?: string;
  textIndexStatus?: string;
  warnings: unknown[];
}

function capabilityRevision(
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

export function summarizeRepositoryCapabilities(
  descriptor: RepositoryDescriptorSnapshot,
): RepositoryCapabilitySummary {
  return descriptor.roots.flatMap((root) =>
    root.capabilities.map((entry) => ({
      rootId: root.rootId,
      capability: entry.capability,
      status: entry.status,
      reasonCode: entry.reasonCode,
      revision: capabilityRevision(root, entry.capability),
      profile: entry.capability === 'vectorIndex' ? root.vectorProfile : undefined,
    })),
  );
}

export function writeRepositoryCapabilityLines(
  io: SessionIo,
  descriptor: RepositoryDescriptorSnapshot,
): void {
  for (const capability of summarizeRepositoryCapabilities(descriptor)) {
    const suffix = [
      capability.revision ? `revision=${capability.revision}` : undefined,
      capability.profile ? `profile=${capability.profile}` : undefined,
      capability.reasonCode ? `reason=${capability.reasonCode}` : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    io.writeStdout(
      `capability root=${capability.rootId} ${capability.capability}=${capability.status}${suffix ? ` ${suffix}` : ''}\n`,
    );
  }
}

export function writeIndexHealthLines(io: SessionIo, cwd: string): void {
  const health = readIndexPipelineHealth({ workspaceRoot: cwd });
  for (const line of formatIndexPipelineHealthLines(health)) {
    io.writeStdout(`${line}\n`);
  }
}
