/**
 * S1-MONOREPO — pick workRoot from catalog projects + focus paths.
 * Longest project id that prefixes a focus path wins; never invents roots.
 */

export interface ResolveWorkRootProject {
  id: string;
}

export function resolveWorkRoot(input: {
  focusPaths: readonly string[];
  projects?: readonly ResolveWorkRootProject[];
}): string | undefined {
  const projects = (input.projects ?? [])
    .map((p) => p.id.trim().replace(/\/+$/, ""))
    .filter((id) => id.length > 0 && id !== ".");
  if (projects.length === 0) return undefined;

  let best: string | undefined;
  let bestLen = -1;
  for (const rawFocus of input.focusPaths) {
    const focus = rawFocus.trim().replace(/\/+$/, "");
    if (!focus) continue;
    for (const id of projects) {
      if (focus === id || focus.startsWith(`${id}/`)) {
        if (id.length > bestLen) {
          best = id;
          bestLen = id.length;
        }
      }
    }
  }
  return best;
}
