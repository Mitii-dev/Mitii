import {
  compileGrantFromPlate,
  selectDecisionPlate,
  type GrantProfile,
  type ToolGrant,
} from "../../../modules/decision-policy";
import { selectRouteBody } from "../../helpers/routes";
import type { RouteBodyPlan } from "../../helpers/routes";
import { scopesFromVerdict } from "../../helpers/grant/ScopesFromVerdict";
import { captureVerificationBaseline } from "../../helpers/verify/CaptureVerificationBaseline";
import type { TaskDirectionAssessment } from "../../contracts/assess/TaskDirectionAssessment";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { StepContext } from "./StepContext";

export interface RuntimeVerificationSketch {
  required: boolean;
  minimumEvidence: string[];
  /** Alias of minimumEvidence (S12). */
  checks?: string[];
  allowUnavailable: boolean;
  onFailure?: "retry" | "report" | "block";
}

export interface RuntimeDecisionSketch {
  plateId: string;
  route: string;
  grantProfile: string;
  planningDepth: string;
  planGate: string;
  runDisposition: "continue" | "clarification_required";
  routeBody: RouteBodyPlan;
  pathScopes: string[];
  mutationPathScopes?: string[];
  scopeEvidence?: string;
  toolGrant: ToolGrant;
  /** ExecutionDecision-shaped verification requirement (S2C). */
  verification: RuntimeVerificationSketch;
  repositoryContextRequired: boolean;
  rationale: string;
  reasonCodes: string[];
}

/**
 * Step 5 — Decide via plate registry (authority). Maps plate `answer` → live wire route.
 */
export function decide(ctx: StepContext): RuntimeDecisionSketch {
  // S10-REPLATE: keep minted execute decision from plan-approve resume.
  const replateMeta = ctx.store.getSlice("replateMeta");
  const existing = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  if (
    replateMeta &&
    existing?.reasonCodes?.includes("replate_on_plan_approve")
  ) {
    return existing;
  }

  const assessment = ctx.store.getSlice<TaskDirectionAssessment>("assessment");
  if (!assessment) {
    throw new Error("decide requires assessment slice");
  }

  const pack = ctx.store.getSlice<SituationPack>("situationPack");
  const mode = ctx.mode ?? "agent";
  const clarity =
    typeof assessment.clarityConfidence === "number"
      ? assessment.clarityConfidence < 0.35
        ? "low"
        : assessment.clarityConfidence < 0.7
          ? "medium"
          : "high"
      : assessment.clarityConfidence;

  const plate = selectDecisionPlate({
    mode,
    primaryTaskIntent: assessment.primaryTaskIntent,
    clarityConfidence: clarity,
    planningHint: assessment.planningHint,
    askUser: assessment.askUserSuggested ?? assessment.askUser,
    risk: assessment.risk,
    difficulty: assessment.difficulty,
    userQuestions: assessment.userQuestions,
    clarificationQuestions: assessment.clarificationQuestions,
    turnKind: ctx.input.turnKind ?? "new",
    message: pack?.request?.text ?? pack?.requestText ?? ctx.input.message,
    interactionIntent: assessment.interactionIntent,
    secondaryTaskIntents: assessment.secondaryTaskIntents,
    priorRoute: pack?.history?.priorRoute ?? ctx.input.history?.priorRoute,
    endingPosture:
      pack?.history?.endingPosture ?? ctx.input.history?.endingPosture,
  });

  // S2C: plate `answer` is the live wire route (legacy aliases shimmed elsewhere).
  const wireRoute = plate.route;

  const routeBody = selectRouteBody({
    route: wireRoute,
    planningDepth: plate.planningDepth,
    planGate: plate.planGate,
  });

  const scopes = scopesFromVerdict(pack?.scope);
  const mcpIds =
    pack?.pins?.mcpIds ??
    ctx.input.requiredMcpServerIds ??
    ctx.input.mcpServerIds ??
    [];

  const compiled = compileGrantFromPlate({
    grantProfile: plate.grantProfile as GrantProfile,
    pathScopes: scopes.pathScopes,
    mutationPathScopes: scopes.mutationPathScopes,
    protectedPathGlobs: scopes.scopes.protectedPaths,
    mcpServerIds: mcpIds,
    ...(ctx.input.approvalMode
      ? { approvalMode: ctx.input.approvalMode }
      : {}),
  });

  const isExecute = wireRoute === "execute";
  const verification: RuntimeVerificationSketch = isExecute
    ? {
        required: true,
        minimumEvidence: ["diagnostics", "diff_review"],
        checks: ["diagnostics", "diff_review"],
        allowUnavailable: true,
        onFailure: "retry",
      }
    : {
        required: false,
        minimumEvidence: [],
        checks: [],
        allowUnavailable: true,
        onFailure: "report",
      };

  // S12-BASELINE: pin cheap host diagnostics before mutations.
  let baselineCode: string | undefined;
  if (isExecute) {
    const baseline = captureVerificationBaseline({
      diagnostics: ctx.input.host?.diagnostics,
      dirtyPaths: ctx.input.host?.dirtyPaths,
      focusedFile: ctx.input.host?.focusedFile,
    });
    ctx.store.setSlice("verifyBaseline", baseline);
    baselineCode =
      baseline.source === "empty"
        ? "verify_baseline_empty"
        : "verify_baseline_pinned";
  }

  const sketch: RuntimeDecisionSketch = {
    plateId: plate.id,
    route: wireRoute,
    grantProfile: plate.grantProfile,
    planningDepth: plate.planningDepth,
    planGate: plate.planGate,
    runDisposition:
      plate.route === "clarify" ? "clarification_required" : "continue",
    routeBody,
    pathScopes: scopes.pathScopes,
    ...(scopes.mutationPathScopes
      ? { mutationPathScopes: scopes.mutationPathScopes }
      : {}),
    scopeEvidence: pack?.scope.evidence,
    toolGrant: compiled.toolGrant,
    verification,
    repositoryContextRequired:
      plate.grantProfile === "research" || plate.grantProfile === "agent_execute",
    rationale: `plate=${plate.id}; route=${wireRoute}; depth=${plate.planningDepth}`,
    reasonCodes: [
      ...plate.reasonCodes,
      ...routeBody.reasonCodes,
      ...scopes.reasonCodes,
      ...compiled.reasonCodes,
      isExecute ? "verification_required" : "verification_not_required",
      ...(baselineCode ? [baselineCode] : []),
      "runtime_decide_plate",
    ],
  };

  ctx.store.setSlice("decision", sketch);
  return sketch;
}
