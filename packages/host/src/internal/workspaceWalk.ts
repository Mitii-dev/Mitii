import { isSecurityConcern, WS_CONSTANTS } from '@mitii/v8';

/**
 * Directory names skipped when walking a workspace for fingerprint / file-map.
 * Keep this list identical across indexing fingerprint and repository-context.
 */
export const WORKSPACE_WALK_SKIP_DIR_NAMES = new Set([
  ...WS_CONSTANTS.DEFAULT_IGNORED_DIRECTORY_NAMES,
  '.firebase',
]);

export function shouldSkipWorkspaceWalkFile(
  relativePath: string,
  fileName: string,
): boolean {
  const extension = `.${fileName.split('.').pop() ?? ''}`.toLowerCase();
  return (
    isSecurityConcern(relativePath) ||
    WS_CONSTANTS.DEFAULT_IGNORED_FILE_NAMES.has(fileName) ||
    WS_CONSTANTS.DEFAULT_IGNORED_EXTENSIONS.has(extension)
  );
}
