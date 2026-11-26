import type { StepContext } from "./StepContext";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { ContextBundle } from "../../contracts/enrich/ContextBundle";
import type { TaskHandoffNote } from "../../contracts/handoff/TaskHandoffNote";
import {
  buildFullContextBundle,
  prioritizeOmissions,
  refreshContextBundleLight,
  retrieveEnrichMaterials,
  sectionBudgetsFromWindowPolicy,
} from "../../helpers/enrich";
import { selectBriefcaseHandoffPeaks } from "../../helpers/handoff";
import { resolveOrientDepth } from "../../helpers/orient";
import type { TaskList } from "../../../modules/task-list";
import type { RuntimeDecisionSketch } from "./5-Decide";

/** @deprecated Prefer ContextBundle from contracts/enrich. */
export type ContextBundleSketch = ContextBundle;

/**
 * Step 9 — Enrich → ContextBundle (S11).
 * Full enrich at loop entry; pass `light` + prior for post-mutation refresh.
 * Prefer `enrichContextWithRetrieval` when deps.enrich ports are set.
 */
export function enrichContext(
  ctx: StepContext,
  opts?: {
    mode?: "full" | "light";
    changedPaths?: readonly string[];
    diagnostics?: readonly string[];
    skillInstructions?: readonly string[];
    memoryFacts?: readonly string[];
    repoSlices?: readonly string[];
    projectRulesText?: string;
    decisionBrief?: string;
    extraReasonCodes?: readonly string[];
  },
): ContextBundle {
  const pack = ctx.store.getSlice<SituationPack>("situationPack");
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  const mode = opts?.mode ?? "full";

  if (mode === "light") {
    const previous =
      ctx.store.getSlice<ContextBundle>("contextBundle") ??
      buildFullContextBundle({
        pack,
        route: decision?.route,
        grantProfile: decision?.grantProfile,
      });
    const bundle = refreshContextBundleLight({
      previous,
      changedPaths: opts?.changedPaths,
      diagnostics: opts?.diagnostics,
      memoryFacts: opts?.memoryFacts,
    });
    ctx.store.setSlice("contextBundle", bundle);
    return bundle;
  }

  const skillIds = pack?.pins?.skillIds ?? [];
  const skillInstructions =
    opts?.skillInstructions ??
    (skillIds.length > 0 ? skillIds.map((id) => `skill:${id}`) : undefined);

  const taskList = ctx.store.getSlice<TaskList>("taskList");
  const handoffs = ctx.store.getSlice<TaskHandoffNote[]>("taskHandoffs");
  const planObjective =
    ctx.store.getSlice<{ objective?: string }>("planArtifact")?.objective;
  const peaks = selectBriefcaseHandoffPeaks({
    taskList,
    handoffs,
    planObjective,
  });

  let bundle = buildFullContextBundle({
    pack,
    route: decision?.route,
    grantProfile: decision?.grantProfile,
    decisionBrief: opts?.decisionBrief,
    skillInstructions,
    memoryFacts: opts?.memoryFacts,
    repoSlices: opts?.repoSlices,
    projectRulesText: opts?.projectRulesText,
    taskListPresent: Boolean(taskList),
    planRef: ctx.store.getSlice<{ id?: string }>("planArtifact")?.id,
    handoffPeaks: peaks,
  });

  if (opts?.extraReasonCodes && opts.extraReasonCodes.length > 0) {
    bundle = {
      ...bundle,
      reasonCodes: [...bundle.reasonCodes, ...opts.extraReasonCodes],
    };
  }

  // S11-BUDGET — omit low-priority slices against WindowPolicy section shares.
  const windowPolicy = ctx.store.getSlice<{
    sections?: {
      skillsTokens?: number;
      repositoryTokens?: number;
    };
    skills?: { budgetTokens?: number; maxSkills?: number };
    compaction?: { memoryReinjectChars?: number };
  }>("windowPolicy");
  if (windowPolicy?.sections || windowPolicy?.skills) {
    const applied = prioritizeOmissions({
      bundle,
      budgets: sectionBudgetsFromWindowPolicy(windowPolicy),
      focusPaths: pack?.scope.focusPaths ?? [],
      requiredSkillIds: skillIds,
    });
    bundle = applied.bundle;
  }

  ctx.store.setSlice("contextBundle", bundle);
  return bundle;
}

/** Full enrich via RuntimeDependencies.enrich ports (S11-MEM / enrich ports). */
export async function enrichContextWithRetrieval(
  ctx: StepContext,
  opts?: {
    projectRulesText?: string;
    decisionBrief?: string;
  },
): Promise<ContextBundle> {
  const pack = ctx.store.getSlice<SituationPack>("situationPack");
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  const windowPolicy = ctx.store.getSlice<{
    band?: string;
    contextWindowTokens?: number;
  }>("windowPolicy");
  const windowBand = ctx.store.getSlice<{ band?: string }>("windowBand");
  const depth = resolveOrientDepth({
    mode: ctx.mode,
    windowBand: windowBand?.band ?? windowPolicy?.band,
    contextWindowTokens:
      windowPolicy?.contextWindowTokens ?? ctx.input.contextWindowTokens,
    route: decision?.route,
  });
  ctx.store.setSlice("orientDepth", depth);

  // S1-GATE — light: pin/focus stubs only; heavy: module retrieve ports.
  const materials = await retrieveEnrichMaterials({
    ports: depth.depth === "heavy" ? ctx.deps?.enrich : undefined,
    skillIds: pack?.pins?.skillIds ?? [],
    query: pack?.request?.text ?? ctx.input.message,
    focusPaths: pack?.scope.focusPaths ?? [],
    route: decision?.route,
    maxSkills: depth.maxSkills,
    maxMemory: depth.maxMemory,
    maxRepo: depth.maxRepo,
  });

  return enrichContext(ctx, {
    skillInstructions: materials.skillInstructions,
    memoryFacts: materials.memoryFacts,
    repoSlices: materials.repoSlices,
    projectRulesText: opts?.projectRulesText,
    decisionBrief: opts?.decisionBrief,
    extraReasonCodes: [...depth.reasonCodes, ...materials.reasonCodes],
  });
}
