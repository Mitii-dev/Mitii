import type { RequestUnderstandingResult } from "../../request-understanding";

import {
  MUTATION_TOOL_IDS,
  READ_ONLY_TOOL_IDS,
} from "../constants";
import type {
  DecisionReasonCode,
  ExecutionRoute,
  ToolGrant,
} from "../contracts";
import {
  DEFAULT_NONE_TOOL_GRANT_LIMITS,
  DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS,
  DEFAULT_TOOL_GRANT_LIMITS,
} from "../defaults";

export interface ToolGrantResolution {
  toolGrant: ToolGrant;
  reasonCodes: DecisionReasonCode[];
}

export function buildToolGrant(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  understanding: RequestUnderstandingResult;
}): ToolGrantResolution {
  const { mode, route, understanding } = params;
  const reasonCodes: DecisionReasonCode[] = [];
  const pathScopes = resolvePathScopes(understanding);

  if (route === "clarify" || route === "direct_answer") {
    return {
      toolGrant: {
        maximumWorkspaceEffect: "none",
        allowedTools: [],
        allowedEffects: [],
        pathScopes,
        approvalMode: "never",
        limits: { ...DEFAULT_NONE_TOOL_GRANT_LIMITS },
      },
      reasonCodes,
    };
  }

  if (
    route === "repository_answer" ||
    route === "diagnose" ||
    route === "plan" ||
    mode === "ask" ||
    mode === "plan"
  ) {
    if (route === "diagnose") {
      reasonCodes.push("diagnosis_readonly");
    }
    if (mode === "ask") {
      reasonCodes.push("mode_ask_readonly");
    }
    if (mode === "plan") {
      reasonCodes.push("mode_plan_only");
    }

    return {
      toolGrant: {
        maximumWorkspaceEffect: "read",
        allowedTools: [...READ_ONLY_TOOL_IDS],
        // process_execute is required so Tool Runtime can run argv-only
        // read-only commands covered by commandRules; it is not write authority.
        allowedEffects: ["workspace_read", "process_execute"],
        pathScopes,
        commandRules: [
          {
            prefixes: ["git status", "git diff", "git log"],
            allowShellMetacharacters: false,
          },
        ],
        networkHosts: [],
        approvalMode: "never",
        limits: { ...DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS },
      },
      reasonCodes,
    };
  }

  // execute in agent mode
  const risk = understanding.taskAnalysis.risk;
  const approvalMode =
    risk === "high" || risk === "critical" ? "every_mutation" : "when_required";

  if (approvalMode === "every_mutation") {
    reasonCodes.push("high_risk_approval");
  }
  reasonCodes.push("mutation_execute");

  return {
    toolGrant: {
      maximumWorkspaceEffect: "write",
      allowedTools: [...READ_ONLY_TOOL_IDS, ...MUTATION_TOOL_IDS],
      allowedEffects: [
        "workspace_read",
        "workspace_write",
        "process_execute",
      ],
      pathScopes,
      commandRules: [
        {
          prefixes: ["git status", "git diff", "git log"],
          allowShellMetacharacters: false,
        },
      ],
      networkHosts: [],
      approvalMode,
      limits: { ...DEFAULT_TOOL_GRANT_LIMITS },
    },
    reasonCodes,
  };
}

function resolvePathScopes(
  understanding: RequestUnderstandingResult,
): string[] {
  const explicitPaths = understanding.taskAnalysis.targets
    .filter(
      (target) =>
        target.explicit &&
        (target.kind === "file" || target.kind === "folder") &&
        target.value.length > 0,
    )
    .map((target) => target.value);

  if (explicitPaths.length > 0) {
    return explicitPaths;
  }

  return ["."];
}
