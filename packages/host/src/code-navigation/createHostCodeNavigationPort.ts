import {
  FallbackCodeNavigationAdapter,
  GraphCodeNavigationAdapter,
  type CodeNavigationPort,
} from '@mitii/v8';

import { loadWorkspaceGraphs } from '../repository-graph/loadWorkspaceGraphs.js';
import type { OpenHostSqliteDatabase } from '../sqlite/types.js';
import { SymbolRefsCodeNavigationAdapter } from './SymbolRefsCodeNavigationAdapter.js';

export function createHostCodeNavigationPort(options: {
  workspaceRoot: string;
  languageServer?: CodeNavigationPort;
  openDatabase?: OpenHostSqliteDatabase;
}): CodeNavigationPort {
  const graph = new GraphCodeNavigationAdapter({
    loadGraphs: () => loadWorkspaceGraphs(options.workspaceRoot),
  });

  const symbolRefs = options.openDatabase
    ? new SymbolRefsCodeNavigationAdapter({
        workspaceRoot: options.workspaceRoot,
        openDatabase: options.openDatabase,
      })
    : undefined;

  const coldFallback = symbolRefs
    ? new FallbackCodeNavigationAdapter({
        primary: symbolRefs,
        fallback: graph,
      })
    : graph;

  if (!options.languageServer) {
    return coldFallback;
  }
  return new FallbackCodeNavigationAdapter({
    primary: options.languageServer,
    fallback: coldFallback,
  });
}
