/**
 * Directory names skipped when walking a workspace for fingerprint / file-map.
 * Keep this list identical across indexing fingerprint and repository-context.
 */
export const WORKSPACE_WALK_SKIP_DIR_NAMES = new Set([
  '.git',
  '.docusaurus',
  '.firebase',
  'node_modules',
  'dist',
  'coverage',
  '.mitii',
  '.cursor',
]);
