/** Repository context — hybrid retrieval, code navigation, and workspace graphs. */

export { createHostRepositoryContext } from '../repository-context/createHostRepositoryContext.js';
export type { HostEditorContextReferences } from '../repository-context/createHostRepositoryContext.js';
export {
  buildWorkspaceSketch,
  WORKSPACE_SKETCH_DEFAULTS,
} from '../repository-context/workspaceSketch.js';
export type {
  WorkspaceSketchOptions,
  WorkspaceSketchResult,
} from '../repository-context/workspaceSketch.js';

export { createHostCodeNavigationPort } from '../code-navigation/createHostCodeNavigationPort.js';
export { createHostLanguageServices } from '../code-navigation/createHostLanguageServices.js';
export type { HostLanguageServices } from '../code-navigation/createHostLanguageServices.js';
export { createNodeJsDiagnosticsPort } from '../code-navigation/createNodeJsDiagnosticsPort.js';
export {
  createStdioLspCodeNavigationPort,
  StdioLspCodeNavigationPort,
} from '../code-navigation/createStdioLspCodeNavigationPort.js';
export type {
  StdioLspServerConfig,
  CreateStdioLspCodeNavigationPortOptions,
} from '../code-navigation/createStdioLspCodeNavigationPort.js';
export { resolveLspSpawnInvocation } from '../code-navigation/stdio-lsp/resolveLspSpawn.js';
export type { LspSpawnInvocation } from '../code-navigation/stdio-lsp/resolveLspSpawn.js';
export { discoverStdioLspServers } from '../code-navigation/stdio-lsp/discoverStdioLspServers.js';

export {
  createHostRepositoryGraphPort,
  loadWorkspaceGraphs,
  resolveExpectedCodeIndexChangeToken,
  workspaceGraphLooksStale,
  WORKSPACE_DIRTY_CHANGE_TOKEN_SUFFIX,
} from '../repository-graph/loadWorkspaceGraphs.js';
