import type { RequestUnderstandingResult } from "../../request-understanding";

import type {
  DecisionReasonCode,
  ExecutionRoute,
  ToolGrant,
} from "../contracts";
import { isRepairIntentTaxonomy } from "../patterns";

export interface PreflightBuildResolution {
  run: boolean;
  reasonCodes: DecisionReasonCode[];
}

/**
 * Agent execute always captures a preflight snapshot when the grant allows
 * it — errors should inform classification, not just "wide repair" asks.
 * Plan mode stays repair-intent-gated: a visible plan only needs the
 * snapshot when it will build a follow_evidence plan.
 */
export function resolvePreflightBuild(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  understanding: RequestUnderstandingResult;
  grant: ToolGrant;
}): PreflightBuildResolution {
  const { mode, route, understanding, grant } = params;
  const eligibleRoute =
    (mode === "agent" && route === "execute") ||
    (mode === "plan" && route === "plan");
  if (!eligibleRoute) {
    return { run: false, reasonCodes: [] };
  }
  if (!grant.allowedTools.includes("run_readonly_command")) {
    return { run: false, reasonCodes: [] };
  }
  if (!grant.allowedEffects.includes("process_execute")) {
    return { run: false, reasonCodes: [] };
  }

  if (mode === "agent") {
    return { run: true, reasonCodes: ["preflight_build_recommended"] };
  }

  const planRepair =
    isRepairIntent(understanding) &&
    (understanding.taskAnalysis.scope === "package" ||
      understanding.taskAnalysis.scope === "repository" ||
      understanding.taskAnalysis.scope === "workspace" ||
      understanding.taskAnalysis.scope === "multi_file" ||
      understanding.taskAnalysis.recommendsVerification === true);

  return planRepair
    ? { run: true, reasonCodes: ["preflight_build_recommended"] }
    : { run: false, reasonCodes: [] };
}

function isRepairIntent(understanding: RequestUnderstandingResult): boolean {
  return isRepairIntentTaxonomy([
    understanding.intent.classification.primaryTaskIntent,
    ...understanding.intent.classification.secondaryTaskIntents,
  ]);
}
