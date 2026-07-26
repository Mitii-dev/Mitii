import type { RequestUnderstandingResult } from "../../request-understanding";

import type {
  DecisionReasonCode,
  ExecutionRoute,
  VerificationRequirement,
} from "../contracts";

export interface VerificationResolution {
  verification: VerificationRequirement;
  reasonCodes: DecisionReasonCode[];
}

export function resolveVerificationRequirement(params: {
  route: ExecutionRoute;
  mode: "ask" | "plan" | "agent";
  understanding: RequestUnderstandingResult;
  maximumWorkspaceEffect: "none" | "read" | "write";
}): VerificationResolution {
  const { route, understanding, maximumWorkspaceEffect } = params;
  const reasonCodes: DecisionReasonCode[] = [];

  if (maximumWorkspaceEffect !== "write" || route !== "execute") {
    reasonCodes.push("verification_not_required");
    return {
      verification: {
        required: false,
        minimumEvidence: [],
        allowUnavailable: true,
      },
      reasonCodes,
    };
  }

  reasonCodes.push("verification_required");
  const minimumEvidence: VerificationRequirement["minimumEvidence"] = [
    "diagnostics",
    "diff_review",
  ];

  if (understanding.taskAnalysis.recommendsVerification) {
    minimumEvidence.push("tests");
  }

  if (
    understanding.taskAnalysis.complexity === "complex" ||
    understanding.taskAnalysis.complexity === "very_complex" ||
    understanding.taskAnalysis.risk === "high" ||
    understanding.taskAnalysis.risk === "critical"
  ) {
    if (!minimumEvidence.includes("typecheck")) {
      minimumEvidence.push("typecheck");
    }
  }

  return {
    verification: {
      required: true,
      minimumEvidence,
      allowUnavailable: false,
    },
    reasonCodes,
  };
}
