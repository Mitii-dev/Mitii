/**
 * Budgeted surroundings for Orient navigation (boost, don’t hard-fence).
 */

export function buildOrientSurroundings(input: {
  focusPaths: readonly string[];
  workRoot?: string;
  relatedProjects?: readonly string[];
  limit?: number;
}): string[] {
  const limit = input.limit ?? 12;
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (path: string | undefined) => {
    const trimmed = path?.trim().replace(/\/+$/, "");
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  if (input.workRoot) push(input.workRoot);

  for (const focus of input.focusPaths) {
    push(focus);
    const parts = focus.split("/").filter(Boolean);
    if (parts.length > 1) {
      push(parts.slice(0, -1).join("/"));
    }
    if (parts.length > 2) {
      push(parts.slice(0, -2).join("/"));
    }
    if (out.length >= limit) break;
  }

  for (const related of input.relatedProjects ?? []) {
    push(related);
    if (out.length >= limit) break;
  }

  return out.slice(0, limit);
}
