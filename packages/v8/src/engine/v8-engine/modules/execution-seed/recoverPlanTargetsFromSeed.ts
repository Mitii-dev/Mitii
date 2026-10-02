/**
 * One bounded recovery: stamp trusted seed paths onto Change steps that lack
 * file targetRefs, so deriveTaskListFromPlan can produce concrete rows.
 * Does NOT invent a synthetic checklist row when the plan has no Change steps.
 */
import type { PlanArtifact } from "../../../../modules/planning";

import type { ExecutionSeed } from "./resolve";
import { isExecutionSeedTrusted } from "./resolve";

const FILE_HINT = /\.\w{1,16}$/;
const MAX_SEED_TARGETS = 6;

export function recoverPlanTargetsFromSeed(params: {
  plan: PlanArtifact;
  seed: ExecutionSeed | undefined;
}): { plan: PlanArtifact; recovered: boolean } {
  const { plan, seed } = params;
  if (!isExecutionSeedTrusted(seed) || !seed || seed.paths.length === 0) {
    return { plan, recovered: false };
  }

  const seedPaths = uniqueFilePaths(seed.paths).slice(0, MAX_SEED_TARGETS);
  if (seedPaths.length === 0) {
    return { plan, recovered: false };
  }

  let recovered = false;
  const phases = plan.phases.map((phase) => {
    if (!isChangeLikePhase(phase.name)) {
      return phase;
    }
    const steps = phase.steps.map((step) => {
      const existing = uniqueFilePaths(step.targetRefs ?? []);
      if (existing.length > 0) {
        return step;
      }
      // Only recover steps that look like real work intents (not process meta).
      if (!step.intent?.trim()) {
        return step;
      }
      recovered = true;
      return {
        ...step,
        targetRefs: seedPaths,
        mustRead:
          uniqueFilePaths(step.mustRead ?? []).length > 0
            ? step.mustRead
            : seedPaths,
      };
    });
    return { ...phase, steps };
  });

  if (!recovered) {
    return { plan, recovered: false };
  }

  return {
    plan: { ...plan, phases },
    recovered: true,
  };
}

function isChangeLikePhase(name: string): boolean {
  return /^(?:change|implement|fix|build|edit|update)\b/i.test(name.trim());
}

function uniqueFilePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const normalized = path
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "");
    if (!normalized || !FILE_HINT.test(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}
