/**
 * Thin anti-junk gate for plan artifacts already validated by modules/planning.
 * Rejects empty / title-only / generic three-phase skeletons.
 */
export function rejectHollowPlan(plan: {
  phases?: Array<{ name?: string; steps?: unknown[] }>;
  title?: string;
}): { ok: true } | { ok: false; reasonCode: string } {
  const phases = plan.phases ?? [];
  if (phases.length === 0) {
    return { ok: false, reasonCode: "plan_hollow_no_phases" };
  }

  const title = (plan.title ?? "").trim();
  if (title.length > 0 && phases.length === 1) {
    const only = phases[0];
    const steps = only?.steps ?? [];
    if (steps.length === 0 && !(only?.name && only.name.trim().length > 0)) {
      return { ok: false, reasonCode: "plan_hollow_title_only" };
    }
  }

  const allSteps = phases.flatMap((p) => p.steps ?? []);
  if (allSteps.length === 0) {
    return { ok: false, reasonCode: "plan_hollow_no_steps" };
  }

  const names = phases.map((p) => (p.name ?? "").toLowerCase());
  const looksLikeGenericSkeleton =
    names.length >= 3 &&
    names.some((n) => /investigat|discover|explor/.test(n)) &&
    names.some((n) => /implement|change|fix|build/.test(n)) &&
    names.some((n) => /test|verif/.test(n)) &&
    allSteps.length <= 3;

  if (looksLikeGenericSkeleton) {
    return { ok: false, reasonCode: "plan_hollow_generic_skeleton" };
  }

  return { ok: true };
}
