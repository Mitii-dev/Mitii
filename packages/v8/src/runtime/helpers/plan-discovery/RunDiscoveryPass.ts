/**
 * S3A.2 bounded readonly discovery pump (§6.2).
 * Seeds from SituationPack; optional tool peeks under discovery budget + readonly grant.
 */

import {
  PLANNING_SCHEMA_VERSION,
  PlanningPipeline,
  type DiscoveryBrief,
  type DiscoveryObservation,
} from "../../../modules/planning";
import type { DiscoveryPassBudget } from "../../../modules/window-budget";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { RuntimeToolExecutorPort } from "../../ports/RuntimeToolExecutorPort";
import { buildReadonlyDiscoveryGrant } from "./BuildReadonlyDiscoveryGrant";
import { peekDiscoveryFromWorkspaceRoot } from "./DiscoveryRootPeeks";
import {
  enforceDiscoveryQualityFloor,
  type EnforceDiscoveryQualityFloorResult,
} from "./EnforceDiscoveryQualityFloor";

export interface RunDiscoveryPassInput {
  objective: string;
  pack?: SituationPack;
  budget: DiscoveryPassBudget;
  /** When set, peeks read_file for unread focus paths (capped). */
  tools?: RuntimeToolExecutorPort;
  requireQualityFloor?: boolean;
  /** Pre-seeded observations (tests / host). */
  seedObservations?: DiscoveryObservation;
}

export interface RunDiscoveryPassResult {
  brief: DiscoveryBrief;
  quality: EnforceDiscoveryQualityFloorResult;
  toolCalls: number;
  fileReads: number;
  searches: number;
  grantTools: string[];
  reasonCodes: string[];
}

function seedFromPack(
  objective: string,
  pack?: SituationPack,
): DiscoveryObservation {
  const focus = pack?.scope.focusPaths ?? [];
  const surroundings = pack?.navigation?.surroundings ?? [];
  const filesRead = [
    ...focus.map((path) => ({
      path,
      reason: "situation_pack_focus",
    })),
    ...surroundings.slice(0, 8).map((path) => ({
      path,
      reason: "situation_pack_surroundings",
    })),
  ];
  const explicitTargets = focus.map((value) => ({
    kind: (value.includes(".") ? "file" : "folder") as "file" | "folder",
    value,
    reason: "focus_path",
    explicit: true,
  }));

  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective,
    filesRead,
    searchHits: [],
    explicitTargets,
    constraints: pack?.request?.intentCues?.constraintSnippets ?? [],
    verificationHints: [],
    notes: [],
  };
}

/**
 * Run a budgeted discovery pass and compile a DiscoveryBrief via planning facade.
 */
export async function runDiscoveryPass(
  input: RunDiscoveryPassInput,
): Promise<RunDiscoveryPassResult> {
  const grant = buildReadonlyDiscoveryGrant({
    readPaths: input.pack?.scope.focusPaths?.length
      ? input.pack.scope.focusPaths
      : ["."],
  });
  const observation: DiscoveryObservation =
    input.seedObservations ??
    seedFromPack(input.objective, input.pack);

  let toolCalls = 0;
  let fileReads = observation.filesRead?.length ?? 0;
  let searches = observation.searchHits?.length ?? 0;
  const reasonCodes = ["discovery_pass_started"];

  const unreadFocus = (input.pack?.scope.focusPaths ?? []).filter(
    (path) =>
      !(observation.filesRead ?? []).some(
        (f) => f.path === path && f.reason !== "situation_pack_focus",
      ),
  );

  if (input.tools && unreadFocus.length > 0) {
    const maxReads = Math.max(
      0,
      input.budget.maxFileReads - fileReads,
    );
    const toPeek = unreadFocus.slice(
      0,
      Math.min(maxReads, input.budget.maxToolCalls, 3),
    );
    for (const path of toPeek) {
      if (toolCalls >= input.budget.maxToolCalls) break;
      if (fileReads >= input.budget.maxFileReads) break;
      const result = await input.tools.execute({
        toolId: "read_file",
        args: { path },
        grant,
        invocationId: `discovery_read_${toolCalls + 1}`,
      });
      toolCalls += 1;
      fileReads += 1;
      if (result.ok) {
        observation.filesRead = [
          ...(observation.filesRead ?? []),
          { path, reason: "discovery_tool_read" },
        ];
        reasonCodes.push("discovery_tool_read_ok");
      } else {
        reasonCodes.push("discovery_tool_read_denied_or_failed");
      }
    }
  } else if (input.tools) {
    // No focus paths — still recon the workspace root so plan mode can draft
    // from real contents instead of empty seed + hollow clarify.
    const rooted = await peekDiscoveryFromWorkspaceRoot({
      observation,
      tools: input.tools,
      grant,
      budget: input.budget,
      toolCalls,
      fileReads,
      searches,
      objective: input.objective,
    });
    observation.filesRead = rooted.observation.filesRead;
    observation.searchHits = rooted.observation.searchHits;
    toolCalls = rooted.toolCalls;
    fileReads = rooted.fileReads;
    searches = rooted.searches;
    reasonCodes.push(...rooted.reasonCodes);
    if (rooted.reasonCodes.every((c) => !c.startsWith("discovery_root_"))) {
      reasonCodes.push("discovery_seed_only");
    }
  } else {
    reasonCodes.push("discovery_seed_only");
  }

  const planning = new PlanningPipeline();
  const brief = planning.compileDiscovery(observation);

  // Floor only after tool-backed peeks; seed-only / no-target passes stay best-effort.
  const quality = enforceDiscoveryQualityFloor({
    brief,
    requireFloor: input.requireQualityFloor === true && toolCalls > 0,
    searchCount: searches,
  });

  return {
    brief,
    quality,
    toolCalls,
    fileReads,
    searches,
    grantTools: grant.allowedTools ?? [],
    reasonCodes: [
      ...reasonCodes,
      "discovery_pass_compiled",
      ...quality.reasonCodes,
    ],
  };
}
