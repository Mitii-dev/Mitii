/** Display helpers for git status and finding severity chips. */

export function statusLabel(status: string): string {
  const normalized = status.trim() || '?';
  if (normalized.includes('A') || normalized === 'A') return 'Added';
  if (normalized.includes('D')) return 'Deleted';
  if (normalized.includes('R')) return 'Renamed';
  if (normalized.includes('?')) return 'Untracked';
  if (normalized.includes('M') || normalized === 'M') return 'Edited';
  return normalized;
}

export function statusTone(status: string): string {
  const normalized = status.trim();
  if (
    normalized.includes('A') ||
    normalized.includes('?') ||
    normalized === 'A'
  ) {
    return 'added';
  }
  if (normalized.includes('D')) return 'deleted';
  return 'edited';
}

export function severityTone(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'critical' || s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}
