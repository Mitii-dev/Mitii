/** Path display helpers. */

export function shortPath(path: string): string {
  if (!path) return '—';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-3).join('/')}`;
}

/** Leaf folder name for workspace grouping labels. */
export function workspaceLabel(path: string): string {
  if (!path) return 'Workspace';
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}
