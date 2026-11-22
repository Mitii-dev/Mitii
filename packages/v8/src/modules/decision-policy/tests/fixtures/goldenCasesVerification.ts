import type { GoldenDecisionCase } from "./decisionFixtureTypes";
import {
  createTarget,
  createUnderstanding,
} from "./decisionFixtureHelpers";

/** Golden cases: verification, benchmark-style, origin and repository state. */
export const GOLDEN_DECISION_CASES_VERIFICATION: GoldenDecisionCase[] = [
  // --- Verification / preflight ---
  {
    id: "golden-verif-execute-required",
    category: "verification",
    mode: "agent",
    message: "Update text color in Header component",
    understanding: createUnderstanding({
      primaryTaskIntent: "style",
      taskAnalysis: {
        scope: "single_location",
        recommendsVerification: false,
        targets: [createTarget("src/Header.tsx")],
      },
    }),
    expected: {
      route: "execute",
      verificationRequired: true,
      verificationEvidenceIncludes: ["diagnostics", "diff_review"],
      reasonCodesIncludes: ["verification_required"],
    },
  },
  {
    id: "golden-verif-diagnose-not-required",
    category: "verification",
    mode: "agent",
    message: "Inspect build logs and identify the compilation error",
    understanding: createUnderstanding({
      primaryTaskIntent: "diagnose",
      interactionIntent: "help",
      taskAnalysis: { scope: "repository", recommendsVerification: false },
    }),
    expected: {
      route: "diagnose",
      verificationRequired: false,
      reasonCodesIncludes: ["verification_not_required"],
    },
  },
  {
    id: "golden-preflight-agent-execute",
    category: "verification",
    mode: "agent",
    message: "Fix type mismatches in src/api/client.ts",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        targets: [createTarget("src/api/client.ts")],
      },
    }),
    expected: {
      route: "execute",
      reasonCodesIncludes: ["preflight_build_recommended", "mutation_execute"],
    },
  },

  // --- Benchmark-style ---
  {
    id: "golden-bench-error-boundary",
    category: "benchmark",
    mode: "agent",
    message: "Add `app/error.tsx` error boundary for Next.js App Router",
    understanding: createUnderstanding({
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        targets: [createTarget("app/error.tsx")],
      },
    }),
    expected: {
      route: "execute",
      planningDepth: "none",
      maximumWorkspaceEffect: "write",
      mutationPathScopes: ["app"],
      forbidVisiblePlan: true,
      reasonCodesIncludes: ["mutation_execute", "fast_path_explicit_paths"],
    },
  },
  {
    id: "golden-bench-review-diagnose",
    category: "benchmark",
    mode: "agent",
    message: "Review component structure, no edits",
    understanding: createUnderstanding({
      primaryTaskIntent: "review",
      interactionIntent: "help",
      taskAnalysis: { scope: "repository", recommendsRepositoryDiscovery: true },
    }),
    expected: {
      route: "diagnose",
      maximumWorkspaceEffect: "read",
      // Free-form review intent is diagnose-only — structured findings require
      // Review-button / CLI prep markers (emit_review_finding / Review prep).
      reasonCodesIncludes: ["diagnosis_readonly"],
      reasonCodesExcludes: [
        "review_pipeline_required",
        "review_findings_structured",
      ],
      allowedToolsIncludes: ["read_file", "read_git_status"],
      allowedToolsExcludes: ["apply_patch"],
    },
  },

  {
    id: "golden-bench-review-and-fix",
    category: "benchmark",
    mode: "agent",
    message: "Review these staged changes and fix the blockers",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "multi_file",
        targets: [createTarget("src/Auth.ts")],
      },
    }),
    expected: {
      route: "execute",
      maximumWorkspaceEffect: "write",
      reasonCodesIncludes: ["mutation_execute"],
      allowedToolsIncludes: ["apply_patch"],
    },
  },

  // --- Origin ---
  {
    id: "golden-origin-api-fix-test",
    category: "origin",
    mode: "agent",
    origin: "api",
    message: "Automated alert: Fix failing unit test in tests/auth.test.ts",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "single_location",
        targets: [createTarget("tests/auth.test.ts")],
      },
    }),
    expected: {
      route: "execute",
      runDisposition: "continue",
      maximumWorkspaceEffect: "write",
      reasonCodesIncludes: ["api_origin", "mutation_execute"],
    },
  },

  // --- State ---
  {
    id: "golden-state-degraded-warning",
    category: "state",
    mode: "agent",
    message: "Explain src/index.ts",
    repositoryState: { readiness: "degraded" },
    understanding: createUnderstanding({
      primaryTaskIntent: "question",
      interactionIntent: "question",
      taskAnalysis: {
        scope: "single_location",
        targets: [createTarget("src/index.ts")],
        recommendsRepositoryDiscovery: true,
      },
    }),
    expected: {
      route: "repository_answer",
      reasonCodesIncludes: ["repository_state_degraded"],
      warningsIncludes: ["degraded"],
    },
  },
];
