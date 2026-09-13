import { McpManager, type McpManagerOptions } from './McpManager.js';

/** Shared singleton used by hosts between client recreations. */
let sharedManager: McpManager | undefined;

export function getSharedMcpManager(
  options?: McpManagerOptions,
): McpManager {
  if (!sharedManager) {
    sharedManager = new McpManager(options ?? { clientInfoName: 'mitii' });
  }
  return sharedManager;
}

/** Test helper — reset singleton between suites. */
export function resetSharedMcpManager(): void {
  sharedManager?.dispose();
  sharedManager = undefined;
}
