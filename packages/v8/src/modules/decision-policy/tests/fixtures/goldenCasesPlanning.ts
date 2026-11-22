import type { GoldenDecisionCase } from "./decisionFixtureTypes";
import {
  createTarget,
  createUnderstanding,
  createWindowPolicy,
} from "./decisionFixtureHelpers";

/** Golden cases: clarification and planning. */
export const GOLDEN_DECISION_CASES_PLANNING: GoldenDecisionCase[] = [
  // --- Clarify ---
  {
    id: "golden-clarify-path-target-low-confidence",
    category: "clarify",
    mode: "agent",
    message:
      "Add app/error.tsx for the Next.js App Router error boundary in this project",
    understanding: createUnderstanding({
      primaryTaskIntent: "feature",
      interactionIntent: "act",
      confidence: 0.65,
      needsClarification: true,
      taskAnalysis: {
        scope: "single_location",
        clarity: "partially_clear",
        targets: [createTarget("app/error.tsx")],
      },
    }),
    expected: {
      route: "execute",
      maximumWorkspaceEffect: "write",
      reasonCodesIncludes: ["mutation_execute"],
    },
  },
  {
    id: "golden-clarify-investigate-vs-fix",
    category: "clarify",
    mode: "agent",
    message: "Should I investigate or fix the auth bug?",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      needsClarification: true,
      recommendsClarification: true,
      status: "clarification_required",
      taskAnalysis: {
        clarity: "unclear",
        scope: "unknown",
        recommendsTaskClarification: true,
      },
    }),
    expected: {
      route: "clarify",
      runDisposition: "clarification_required",
      maximumWorkspaceEffect: "none",
      reasonCodesIncludes: ["clarification_material"],
    },
  },
  {
    id: "golden-clarify-resume-context",
    category: "clarify",
    mode: "agent",
    message:
      "Fix the alignment issue\nClarification: use tablet tab navigation bar",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "single_location",
        targets: [createTarget("src/components/Nav.tsx")],
      },
    }),
    expected: {
      route: "execute",
      maximumWorkspaceEffect: "write",
      reasonCodesIncludes: ["mutation_execute"],
    },
  },

  // --- Planning ---
  {
    id: "golden-plan-localized-none",
    category: "plan",
    mode: "agent",
    message: "Fix typo in README.md",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        targets: [createTarget("README.md")],
      },
    }),
    expected: {
      route: "execute",
      planningDepth: "none",
      planGate: "none",
      maximumWorkspaceEffect: "write",
      reasonCodesIncludes: ["fast_path_explicit_paths"],
    },
  },
  {
    id: "golden-plan-multi-file-internal",
    category: "plan",
    mode: "agent",
    message: "Add CSV export feature and wire up UI components",
    understanding: createUnderstanding({
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "multi_file",
        complexity: "moderate",
        risk: "medium",
        estimatedFilesAffected: { minimum: 2, maximum: 4 },
      },
    }),
    expected: {
      route: "execute",
      planningDepth: "internal",
      planGate: "none",
      maximumWorkspaceEffect: "write",
      reasonCodesIncludes: ["multi_file_internal_plan"],
    },
  },
  {
    id: "golden-plan-large-implementation-visible",
    category: "plan",
    mode: "agent",
    message: "Implement the entire mui-builder package like formik",
    understanding: createUnderstanding({
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "package",
        complexity: "complex",
        risk: "medium",
        recommendsPlanning: true,
        estimatedFilesAffected: { minimum: 8, maximum: 20 },
      },
    }),
    windowPolicy: createWindowPolicy({ visiblePlanAffordable: true }),
    expected: {
      route: "execute",
      planningDepth: "visible",
      planGate: "required_before_execute",
      maximumWorkspaceEffect: "write",
      reasonCodesIncludes: [
        "large_implementation_visible_plan",
        "plan_gate_required",
      ],
    },
  },
  {
    id: "golden-plan-large-implementation-internal-window",
    category: "plan",
    mode: "agent",
    message: "Implement the entire mui-builder package like formik",
    understanding: createUnderstanding({
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "package",
        complexity: "complex",
        risk: "medium",
        estimatedFilesAffected: { minimum: 8, maximum: 20 },
      },
    }),
    windowPolicy: createWindowPolicy({ visiblePlanAffordable: false }),
    expected: {
      route: "execute",
      planningDepth: "internal",
      planGate: "none",
      maximumWorkspaceEffect: "write",
      reasonCodesIncludes: [
        "large_implementation_visible_plan",
      ],
    },
  },
  {
    id: "golden-plan-small-package-internal",
    category: "plan",
    mode: "agent",
    message: "Add a small string formatting helper to the core package",
    understanding: createUnderstanding({
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "package",
        complexity: "simple",
        risk: "low",
        estimatedFilesAffected: { minimum: 1, maximum: 2 },
      },
    }),
    windowPolicy: createWindowPolicy({ visiblePlanAffordable: true }),
    expected: {
      route: "execute",
      planningDepth: "internal",
      reasonCodesIncludes: ["multi_file_internal_plan"],
      reasonCodesExcludes: ["large_implementation_visible_plan"],
    },
  },
  {
    id: "golden-plan-explicit-plan-route",
    category: "plan",
    mode: "agent",
    message: "Create a step-by-step plan for SSO migration, don't implement yet",
    understanding: createUnderstanding({
      primaryTaskIntent: "feature",
      interactionIntent: "plan",
      taskAnalysis: {
        scope: "repository",
        complexity: "complex",
        risk: "high",
      },
    }),
    expected: {
      route: "plan",
      planningDepth: "visible",
      maximumWorkspaceEffect: "read",
      reasonCodesIncludes: ["explicit_plan_request"],
    },
  },
  {
    id: "golden-plan-gate-suppressed",
    category: "plan",
    mode: "agent",
    message: "Fix all TS errors across packages/ui",
    planApproval: "never",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "package",
        complexity: "complex",
        risk: "high",
        recommendsPlanning: true,
        estimatedFilesAffected: { minimum: 5, maximum: 20 },
      },
    }),
    windowPolicy: createWindowPolicy({ visiblePlanAffordable: true }),
    expected: {
      route: "execute",
      planningDepth: "visible",
      planGate: "none",
      reasonCodesIncludes: ["plan_gate_suppressed_by_policy"],
    },
  },
];
