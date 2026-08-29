import {
  FallbackCodeNavigationAdapter,
  GraphCodeNavigationAdapter,
  type CodeNavigationPort,
} from '@mitii/v8';

import { loadWorkspaceGraphs } from '../repository-graph/loadWorkspaceGraphs.js';

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
