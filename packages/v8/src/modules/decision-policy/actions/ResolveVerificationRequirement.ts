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
  /** Optional raw user message for frontend/build heuristics. */
  message?: string;
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

  const messageHint = (params.message ?? "").toLowerCase();
  const targetHint = (understanding.taskAnalysis.targets ?? [])
    .map((t) => t.value)
    .join(" ")
    .toLowerCase();
  const combinedHint = `${messageHint} ${targetHint}`;
  const wantsFrontendBuild =
    /\b(?:next\.?js|vite|react|frontend|server action|'use server'|"use server")\b/i.test(
      combinedHint,
    ) || /\b(?:^|\/)(?:app|pages|components|src\/app)\//i.test(combinedHint);

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

  if (wantsFrontendBuild) {
    if (!minimumEvidence.includes("typecheck")) {
      minimumEvidence.push("typecheck");
    }
    if (!minimumEvidence.includes("build")) {
      minimumEvidence.push("build");
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
