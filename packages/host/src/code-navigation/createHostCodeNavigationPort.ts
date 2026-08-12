import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FallbackCodeNavigationAdapter,
  GraphCodeNavigationAdapter,
  repoGraphSchema,
  type CodeNavigationPort,
  type RepoGraph,
} from '@mitii/v8';

export function createHostCodeNavigationPort(options: {
  workspaceRoot: string;
  languageServer?: CodeNavigationPort;
}): CodeNavigationPort {
  const graph = new GraphCodeNavigationAdapter({
    loadGraphs: () => loadWorkspaceGraphs(options.workspaceRoot),
  });
  if (!options.languageServer) {
    return graph;
  }
  return new FallbackCodeNavigationAdapter({
    primary: options.languageServer,
    fallback: graph,
  });
}

function loadWorkspaceGraphs(workspaceRoot: string): RepoGraph[] {
  const mitiiDir = join(workspaceRoot, '.mitii');
  if (!existsSync(mitiiDir)) return [];

  const graphs: RepoGraph[] = [];
  const metadataPath = join(mitiiDir, 'index-runtime.json');
  const artifactPaths = new Set<string>();

  if (existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
        graphArtifactPaths?: Record<string, string>;
      };
      for (const path of Object.values(metadata.graphArtifactPaths ?? {})) {
        artifactPaths.add(path);
      }
    } catch {
      // Fall through to default artifact name.
    }
  }

  artifactPaths.add(join(mitiiDir, 'repository-graph-workspace.json'));

  for (const path of artifactPaths) {
    if (!existsSync(path)) continue;
    try {
      graphs.push(repoGraphSchema.parse(JSON.parse(readFileSync(path, 'utf8'))));
    } catch {
      continue;
    }
  }

  return graphs;
}
