/**
 * Full enrich at loop entry (§11.2.1) — merges SituationPack + decision.
 * Retrieval materials come from RetrieveEnrichMaterials / enrich ports.
 */

import {
  contextBundleSchema,
  type ContextBundle,
} from "../../contracts/enrich/ContextBundle";
import type { SituationPack } from "../../contracts/orient/SituationPack";

export interface BuildFullContextBundleInput {
  pack?: SituationPack;
  route?: string;
  grantProfile?: string;
  decisionBrief?: string;
  planRef?: string;
  taskListPresent?: boolean;
  skillInstructions?: readonly string[];
  memoryFacts?: readonly string[];
  repoSlices?: readonly string[];
  projectRulesText?: string;
  /** S13 Briefcase peaks from selectBriefcaseHandoffPeaks. */
  handoffPeaks?: {
    activeTaskId?: string;
    activeTaskTitle?: string;
    previousHandoffSummary?: string;
    previousFromTaskId?: string;
    planObjective?: string;
    nextMustRead?: readonly string[];
  };
}

export function buildFullContextBundle(
  input: BuildFullContextBundleInput,
): ContextBundle {
  const focusPaths = input.pack?.scope.focusPaths ?? [];
  const route = input.route ?? "unknown";
  const grantProfile = input.grantProfile ?? "none";
  const skillItems = [...(input.skillInstructions ?? [])].slice(0, 16);
  const memoryItems = [...(input.memoryFacts ?? [])].slice(0, 24);
  const repoItems = [
    ...(input.repoSlices ?? []),
    ...focusPaths.slice(0, 8),
    ...(input.pack?.navigation?.surroundings ?? []).slice(0, 8),
  ];
  const uniqueRepo = [...new Set(repoItems.filter(Boolean))].slice(0, 24);
  const rulesText =
    input.projectRulesText ??
    (input.pack?.pins?.projectRules ?? []).join("\n");

  const diagnostics = input.pack?.host?.diagnostics?.slice(0, 16);

  const peaks = input.handoffPeaks;
  const summary = [
    `route=${route}`,
    `grant=${grantProfile}`,
    focusPaths.length > 0
      ? `focus=${focusPaths.slice(0, 6).join(",")}`
      : "focus=none",
    uniqueRepo.length > 0 ? `repo=${uniqueRepo.length}` : "repo=0",
    ...(peaks?.activeTaskId ? [`activeTask=${peaks.activeTaskId}`] : []),
  ].join("; ");

  const reasonCodes = [
    "enrich_full_bundle",
    ...(skillItems.length > 0 ? ["enrich_skills_attached"] : []),
    ...(memoryItems.length > 0 ? ["enrich_memory_attached"] : []),
    ...(uniqueRepo.length > 0 ? ["enrich_repo_attached"] : []),
    ...(rulesText.trim() ? ["enrich_rules_attached"] : []),
    ...(peaks ? ["enrich_handoff_peaks"] : []),
  ];

  return contextBundleSchema.parse({
    schemaVersion: 1,
    summary,
    focusPaths,
    route,
    grantProfile,
    enrichMode: "full",
    ...(rulesText.trim()
      ? {
          projectRules: {
            text: rulesText.slice(0, 12_000),
            tokens: Math.ceil(rulesText.length / 4),
            cacheClass: "stable",
            omissions: [],
          },
        }
      : {}),
    ...(skillItems.length > 0
      ? {
          skills: {
            items: skillItems,
            tokens: skillItems.reduce((n, s) => n + Math.ceil(s.length / 4), 0),
            cacheClass: "stable",
            omissions: [],
          },
        }
      : {}),
    ...(memoryItems.length > 0
      ? {
          memory: {
            items: memoryItems,
            tokens: memoryItems.reduce(
              (n, s) => n + Math.ceil(s.length / 4),
              0,
            ),
            cacheClass: "semi",
            omissions: [],
          },
        }
      : {}),
    ...(uniqueRepo.length > 0
      ? {
          repoContext: {
            items: uniqueRepo,
            tokens: uniqueRepo.reduce((n, s) => n + Math.ceil(s.length / 4), 0),
            cacheClass: "volatile",
            omissions: [],
          },
        }
      : {}),
    ...(input.decisionBrief ? { decisionBrief: input.decisionBrief } : {}),
    ...(input.planRef ? { planRef: input.planRef } : {}),
    ...(input.taskListPresent != null
      ? { taskListPresent: input.taskListPresent }
      : {}),
    ...(peaks
      ? {
          handoffPeaks: {
            ...(peaks.activeTaskId
              ? { activeTaskId: peaks.activeTaskId }
              : {}),
            ...(peaks.activeTaskTitle
              ? { activeTaskTitle: peaks.activeTaskTitle }
              : {}),
            ...(peaks.previousHandoffSummary
              ? { previousHandoffSummary: peaks.previousHandoffSummary }
              : {}),
            ...(peaks.previousFromTaskId
              ? { previousFromTaskId: peaks.previousFromTaskId }
              : {}),
            ...(peaks.planObjective
              ? { planObjective: peaks.planObjective }
              : {}),
            nextMustRead: [...(peaks.nextMustRead ?? [])],
          },
        }
      : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
    reasonCodes,
  });
}
