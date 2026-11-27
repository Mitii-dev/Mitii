/** Session-store key for cross-run dialogue continuity (distinct from runId). */
export function dialogueContinuityStoreKey(sessionId: string): string {
  return `dlg:${sessionId}`;
}
