/**
 * Collect write scopes from plan / task list for replate (S10-REPLATE).
 * Prefer plan Change step targetRefs; fall back to taskList.write paths.
 */

export interface PlanWriteTargetSource {
  phases?: readonly {
    id?: string;
    steps?: readonly {
      targetRefs?: readonly string[];
      write?: readonly string[];
    }[];
  }[];
  items?: readonly {
    write?: readonly string[];
    status?: string;
  }[];
}

/**
 * Paths the approved plan intends to mutate — used as mutation fence ⊆ plan.
 */
export function extractPlanWriteTargets(
  source?: PlanWriteTargetSource,
): string[] {
  if (!source) return [];

  const out: string[] = [];
  for (const phase of source.phases ?? []) {
    for (const step of phase.steps ?? []) {
      for (const ref of step.targetRefs ?? []) {
        if (ref.trim()) out.push(ref.trim());
      }
      for (const w of step.write ?? []) {
        if (w.trim()) out.push(w.trim());
      }
    }
  }
  for (const item of source.items ?? []) {
    if (item.status === "skipped") continue;
    for (const w of item.write ?? []) {
      if (w.trim()) out.push(w.trim());
    }
  }

  return [...new Set(out)].slice(0, 64);
}

/**
 * Build mutation fence ⊆ plan targets.
 * Prefer the tighter of plan-target vs prior fence; never widen past plan.
 */
export function intersectScopesWithPlanTargets(
  candidateScopes: readonly string[],
  planTargets: readonly string[],
): string[] {
  if (planTargets.length === 0) {
    return [];
  }
  if (candidateScopes.length === 0) {
    return [...planTargets];
  }

  const kept = new Set<string>();
  for (const target of planTargets) {
    const t = normalizePath(target);
    for (const scope of candidateScopes) {
      const c = normalizePath(scope);
      if (isUnder(t, c)) {
        // Plan path sits under prior fence → keep the plan path (tighter).
        kept.add(target);
      } else if (isUnder(c, t)) {
        // Prior fence is stricter under the plan target → keep prior.
        kept.add(scope);
      }
    }
  }

  return kept.size > 0 ? [...kept] : [...planTargets];
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}
