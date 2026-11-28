/**
 * Widen grants only through registered upgrade plates (S2C-UPGRADE).
 */

import {
  NETWORK_TOOL_IDS,
  PROCESS_TOOL_IDS,
  READ_ONLY_TOOL_IDS,
  MUTATION_TOOL_IDS,
} from "../constants";
import {
  DecisionPolicyError,
  executionDecisionSchema,
  type ExecutionDecision,
  type ToolGrant,
} from "../contracts";
import { DECISION_PLATE_REGISTRY } from "../plates/ListDecisionPlates";
import { attachUnifiedScopes } from "./AttachUnifiedScopes";
import { DECISION_REASON } from "../constants";
import {
  resolveMutationProfile,
  resolveRoutePriorityStep,
  uniqueReasonCodes,
} from "./decisionSupport";
import { widenToolGrant } from "./grantAdjustment";
import { toolGrantsEquivalent } from "./CompareToolGrants";
import { uniqueStrings } from "./pathScopes";
import { DEFAULT_AGENT_READONLY_COMMAND_PREFIXES } from "./BuildVerificationGrant";
import { DEFAULT_TOOL_GRANT_LIMITS } from "../defaults";

export interface ApplyUpgradePlateInput {
  previous: ExecutionDecision;
  /** Must match a registered upgrade plate id. */
  upgradePlateId: string;
  extraPaths?: readonly string[];
  extraAllowedRoots?: readonly string[];
  extraNetworkHosts?: readonly string[];
}

const UPGRADE_IDS = new Set(
  DECISION_PLATE_REGISTRY.upgrades.map((plate) => plate.id),
);

export function isRegisteredUpgradePlate(id: string): boolean {
  return UPGRADE_IDS.has(id);
}

/**
 * Apply a registered upgrade plate. Casual widen without a plate is rejected.
 */
export function applyUpgradePlate(
  input: ApplyUpgradePlateInput,
): ExecutionDecision {
  const previous = executionDecisionSchema.parse(input.previous);
  const plateId = input.upgradePlateId.trim();
  if (!plateId || !isRegisteredUpgradePlate(plateId)) {
    throw new DecisionPolicyError(
      "invalid_input",
      `widen requires a registered upgrade plate; got "${plateId || "(empty)"}"`,
      { upgradePlateId: plateId },
    );
  }

  let nextGrant = previous.toolGrant;
  let nextRoute = previous.route;

  switch (plateId) {
    case "upgrade_expand_write_paths":
      nextGrant = widenToolGrant({
        previous: previous.toolGrant,
        extraPaths: input.extraPaths ?? [],
        extraAllowedRoots: input.extraAllowedRoots ?? [],
      });
      break;
    case "upgrade_unlock_network":
      nextGrant = unlockNetworkGrant({
        previous: previous.toolGrant,
        extraNetworkHosts: input.extraNetworkHosts ?? [],
      });
      break;
    case "upgrade_unlock_run_command":
      nextGrant = unlockRunCommandGrant(previous.toolGrant);
      break;
    case "upgrade_diagnose_to_execute":
      if (
        previous.route === "diagnose" ||
        previous.route === "answer" ||
        previous.route === "direct_answer" ||
        previous.route === "repository_answer"
      ) {
        nextRoute = "execute";
      }
      nextGrant = ensureExecuteWriteGrant(previous.toolGrant, {
        extraPaths: input.extraPaths ?? [],
        extraAllowedRoots: input.extraAllowedRoots ?? [],
      });
      break;
    default:
      nextGrant = widenToolGrant({
        previous: previous.toolGrant,
        extraPaths: input.extraPaths ?? [],
        extraAllowedRoots: input.extraAllowedRoots ?? [],
        extraNetworkHosts: input.extraNetworkHosts ?? [],
      });
      break;
  }

  nextGrant = attachUnifiedScopes(nextGrant);
  const grantChanged = !toolGrantsEquivalent(previous.toolGrant, nextGrant);
  const routeChanged = nextRoute !== previous.route;
  if (!grantChanged && !routeChanged) {
    return previous;
  }

  const reasonCodes = uniqueReasonCodes([
    ...previous.reasonCodes,
    DECISION_REASON.grantExpanded,
  ]);

  return executionDecisionSchema.parse({
    ...previous,
    route: nextRoute,
    toolGrant: nextGrant,
    reasonCodes,
    rationale: `${previous.rationale}; upgrade=${plateId}`,
    trace: {
      ...previous.trace,
      routePriorityStep:
        previous.trace?.routePriorityStep ??
        resolveRoutePriorityStep(previous.reasonCodes),
      grantProfile: nextGrant.maximumWorkspaceEffect,
      mutationProfile: resolveMutationProfile(reasonCodes),
      clampedByInjection: previous.trace?.clampedByInjection ?? false,
      signalsUsed: uniqueStrings([
        ...(previous.trace?.signalsUsed ?? []),
        "upgrade_plate",
        plateId,
      ]),
      overrides: [
        ...(previous.trace?.overrides ?? []),
        {
          field: routeChanged ? "route+toolGrant" : "toolGrant",
          from: previous.route,
          to: nextRoute,
          reasonCode: plateId,
        },
      ],
    },
  });
}

function unlockNetworkGrant(params: {
  previous: ToolGrant;
  extraNetworkHosts: readonly string[];
}): ToolGrant {
  const widened = widenToolGrant({
    previous: params.previous,
    extraPaths: [],
    extraNetworkHosts: params.extraNetworkHosts,
  });
  const tools = uniqueStrings([
    ...widened.allowedTools,
    ...NETWORK_TOOL_IDS,
  ]);
  const effects = uniqueStrings([
    ...widened.allowedEffects,
    "network_access",
  ]) as ToolGrant["allowedEffects"];
  return {
    ...widened,
    allowedTools: tools,
    allowedEffects: effects,
  };
}

function unlockRunCommandGrant(previous: ToolGrant): ToolGrant {
  const tools = uniqueStrings([...previous.allowedTools, ...PROCESS_TOOL_IDS]);
  const effects = uniqueStrings([
    ...previous.allowedEffects,
    "process_execute",
  ]) as ToolGrant["allowedEffects"];
  const prefixes = uniqueStrings([
    ...(previous.commandRules ?? []).flatMap((r) => r.prefixes),
    "pnpm",
    "npm",
    "yarn",
    "node",
  ]);
  return {
    ...previous,
    allowedTools: tools,
    allowedEffects: effects,
    commandRules: [
      {
        prefixes: prefixes.length > 0 ? prefixes : ["pnpm", "npm"],
        allowShellMetacharacters: false,
      },
    ],
  };
}

function ensureExecuteWriteGrant(
  previous: ToolGrant,
  extras: {
    extraPaths: readonly string[];
    extraAllowedRoots: readonly string[];
  },
): ToolGrant {
  if (previous.maximumWorkspaceEffect === "write") {
    return widenToolGrant({
      previous,
      extraPaths: extras.extraPaths,
      extraAllowedRoots: extras.extraAllowedRoots,
    });
  }
  const base: ToolGrant = {
    maximumWorkspaceEffect: "write",
    allowedTools: [
      ...READ_ONLY_TOOL_IDS,
      ...MUTATION_TOOL_IDS,
      ...PROCESS_TOOL_IDS,
    ],
    allowedEffects: [
      "workspace_read",
      "workspace_write",
      "process_execute",
    ],
    pathScopes:
      previous.pathScopes.length > 0 ? [...previous.pathScopes] : ["."],
    ...(previous.mutationPathScopes
      ? { mutationPathScopes: [...previous.mutationPathScopes] }
      : {}),
    commandRules: [
      {
        prefixes: [...DEFAULT_AGENT_READONLY_COMMAND_PREFIXES],
        allowShellMetacharacters: false,
      },
    ],
    approvalMode: previous.approvalMode,
    limits: { ...DEFAULT_TOOL_GRANT_LIMITS },
    ...(previous.allowedMcpServerIds
      ? { allowedMcpServerIds: [...previous.allowedMcpServerIds] }
      : {}),
    ...(previous.extraAllowedRoots
      ? { extraAllowedRoots: [...previous.extraAllowedRoots] }
      : {}),
  };
  return widenToolGrant({
    previous: base,
    extraPaths: extras.extraPaths,
    extraAllowedRoots: extras.extraAllowedRoots,
  });
}
