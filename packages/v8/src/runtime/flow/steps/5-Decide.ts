import {
  compileGrantFromPlate,
  selectDecisionPlate,
  type GrantProfile,
  type ToolGrant,
} from "../../../modules/decision-policy";
import { selectRouteBody } from "../../helpers/routes";
import type { RouteBodyPlan } from "../../helpers/routes";
import { scopesFromVerdict } from "../../helpers/grant/ScopesFromVerdict";
import type { TaskDirectionAssessment } from "../../contracts/assess/TaskDirectionAssessment";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { StepContext } from "./StepContext";

export interface RuntimeVerificationSketch {
  required: boolean;
  minimumEvidence: string[];
  allowUnavailable: boolean;
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
  });

  const wireRoute =
    plate.route === "answer" ? "repository_answer" : plate.route;

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
    mcpServerIds: mcpIds,
  });

  const isExecute = wireRoute === "execute";
  const verification: RuntimeVerificationSketch = isExecute
    ? {
        required: true,
        minimumEvidence: ["diagnostics", "diff_review"],
        allowUnavailable: true,
      }
    : {
        required: false,
        minimumEvidence: [],
        allowUnavailable: true,
      };

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
      "runtime_decide_plate",
    ],
  };

  ctx.store.setSlice("decision", sketch);
  return sketch;
}
