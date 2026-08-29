import type {
  PlanArtifact,
  PlanStrategyDecision,
  PlanningParsedInput,
  PlanningReasonCode,
} from "../contracts";
import { PLANNING_WORKING_SET_POLICY } from "../policy";

export interface ApplyPlanWorkingSetsResult {
  plan: PlanArtifact;
  reasonCodes: PlanningReasonCode[];
}

const WORKING_SET_STRATEGIES = new Set([
  "follow_evidence",
  "discover_and_plan",
]);

/**
 * Compile Engine-collected hop-1 graph reports onto Change steps for
 * follow_evidence and discover_and_plan. Planning never walks RepoGraph; it
 * only matches seed paths to targetRefs and caps the lists.
 */
export function applyPlanWorkingSets(params: {
  plan: PlanArtifact;
  input: PlanningParsedInput;
  strategy: PlanStrategyDecision;
}): ApplyPlanWorkingSetsResult {
  if (!WORKING_SET_STRATEGIES.has(params.strategy.strategy)) {
    return { plan: params.plan, reasonCodes: [] };
  }

  const reports = params.input.impactReports ?? [];
  if (reports.length === 0) {
    return { plan: params.plan, reasonCodes: [] };
  }

  const reportsBySeed = new Map<string, { mustRead: string[]; affected: string[] }>();
  for (const report of reports) {
    const seed = normalizePath(report.seedPath);
    if (!seed) continue;
    const existing = reportsBySeed.get(seed) ?? { mustRead: [], affected: [] };
    existing.mustRead = uniquePaths([...existing.mustRead, ...report.mustRead]);
    existing.affected = uniquePaths([...existing.affected, ...report.affected]);
    reportsBySeed.set(seed, existing);
  }
  if (reportsBySeed.size === 0) {
    return { plan: params.plan, reasonCodes: [] };
  }

  let applied = false;
  const phases = params.plan.phases.map((phase) => {
    if (!isChangeLikePhase(phase.name)) {
      return phase;
    }
    return {
      ...phase,
      steps: phase.steps.map((step) => {
        const writeSet = new Set(
          uniquePaths(step.targetRefs).map((path) => normalizePath(path)),
        );
        const mustRead: string[] = [];
        const affected: string[] = [];
        for (const ref of step.targetRefs) {
          const report = reportsBySeed.get(normalizePath(ref));
          if (!report) continue;
          pushExcluded(mustRead, report.mustRead, writeSet);
          pushExcluded(affected, report.affected, writeSet);
        }
        const cappedMustRead = uniquePaths(mustRead).slice(
          0,
          PLANNING_WORKING_SET_POLICY.maxMustRead,
        );
        const cappedAffected = uniquePaths(affected)
          .filter((path) => !cappedMustRead.includes(path))
          .slice(0, PLANNING_WORKING_SET_POLICY.maxAffected);
        if (cappedMustRead.length === 0 && cappedAffected.length === 0) {
          return step;
        }
        applied = true;
        return {
          ...step,
          ...(cappedMustRead.length > 0 ? { mustRead: cappedMustRead } : {}),
          ...(cappedAffected.length > 0 ? { affected: cappedAffected } : {}),
        };
      }),
    };
  });

  if (!applied) {
    return { plan: params.plan, reasonCodes: [] };
  }

  return {
    plan: { ...params.plan, phases },
    reasonCodes: ["plan_working_set_applied"],
  };
}

function isChangeLikePhase(name: string): boolean {
  return /change|implement|fix|build|apply/.test(name.toLowerCase());
}

function pushExcluded(
  target: string[],
  candidates: readonly string[],
  writeSet: ReadonlySet<string>,
): void {
  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);
    if (!normalized || writeSet.has(normalized)) continue;
    target.push(normalized);
  }
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}
