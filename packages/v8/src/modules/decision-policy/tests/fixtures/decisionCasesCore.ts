import { createUnderstanding } from "./decisionCaseBuilders";
import type { DecisionCaseFixture } from "./decisionCaseTypes";

/** Evaluation cases: build, bugfix, feature, diagnosis, review, refactor, docs, git, architecture, ambiguity. */
export const DECISION_EVALUATION_CASES_CORE: DecisionCaseFixture[] = [
  {
    id: "build_failure_localized",
    category: "build_failure",
    mode: "agent",
    message: "Fix the TypeScript build error in src/auth/login.ts",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        targets: [
          { kind: "file", value: "src/auth/login.ts", explicit: true },
        ],
        recommendsPlanning: true,
      },
    }),
    expected: {
      route: "execute",
      planningDepth: "internal",
      maximumWorkspaceEffect: "write",
      forbidVisiblePlan: true,
    },
  },
  {
    id: "localized_bugfix",
    category: "localized_bug",
    mode: "agent",
    message: "Null pointer in parseConfig — fix it.",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        recommendsPlanning: false,
      },
    }),
    expected: {
      route: "execute",
      planningDepth: "internal",
      forbidVisiblePlan: true,
    },
  },
  {
    id: "multi_file_feature",
    category: "feature",
    mode: "agent",
    message: "Add CSV export endpoint and wire it into the reports UI.",
    understanding: createUnderstanding({
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "multi_file",
        complexity: "moderate",
        risk: "medium",
        recommendsPlanning: true,
        estimatedFilesAffected: { minimum: 3, maximum: 6 },
      },
    }),
    expected: {
      route: "execute",
      planningDepth: "internal",
      maximumWorkspaceEffect: "write",
    },
  },
  {
    id: "package_bugfix_visible_plan",
    category: "build_failure",
    mode: "agent",
    message: "Resolve all TypeScript compilation errors in the mui-builder package",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "package",
        complexity: "moderate",
        risk: "low",
        recommendsPlanning: true,
        estimatedFilesAffected: { minimum: 5, maximum: 20 },
      },
    }),
    expected: {
      route: "execute",
      planningDepth: "visible",
      maximumWorkspaceEffect: "write",
    },
  },
  {
    id: "diagnosis_only",
    category: "diagnosis",
    mode: "agent",
    message: "Why is the build failing? Do not change any files.",
    understanding: createUnderstanding({
      primaryTaskIntent: "diagnose",
      interactionIntent: "question",
      taskAnalysis: {
        scope: "package",
        complexity: "moderate",
        risk: "low",
        recommendsRepositoryDiscovery: true,
        recommendsPlanning: false,
        recommendsVerification: false,
      },
    }),
    expected: {
      route: "diagnose",
      maximumWorkspaceEffect: "read",
    },
  },
  {
    id: "review_readonly",
    category: "review",
    mode: "ask",
    message: "Review the auth module for risk.",
    understanding: createUnderstanding({
      primaryTaskIntent: "review",
      interactionIntent: "question",
      taskAnalysis: {
        scope: "package",
        complexity: "moderate",
        risk: "medium",
      },
    }),
    expected: {
      route: "diagnose",
      maximumWorkspaceEffect: "read",
    },
  },
  {
    id: "refactor_localized",
    category: "refactor",
    mode: "agent",
    message: "Extract validation helpers in src/forms/validate.ts",
    understanding: createUnderstanding({
      primaryTaskIntent: "refactor",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        targets: [
          { kind: "file", value: "src/forms/validate.ts", explicit: true },
        ],
      },
    }),
    expected: {
      route: "execute",
      planningDepth: "internal",
      forbidVisiblePlan: true,
    },
  },
  {
    id: "docs_question",
    category: "docs",
    mode: "ask",
    message: "How does repository state publishing work?",
    understanding: createUnderstanding({
      primaryTaskIntent: "docs",
      interactionIntent: "question",
      taskAnalysis: {
        scope: "unknown",
        complexity: "simple",
        risk: "low",
        recommendsRepositoryDiscovery: true,
        recommendsVerification: false,
      },
    }),
    expected: {
      route: "answer",
      maximumWorkspaceEffect: "read",
      planningDepth: "none",
    },
  },
  {
    id: "git_status_question",
    category: "git",
    mode: "ask",
    message: "What changed in the working tree?",
    understanding: createUnderstanding({
      primaryTaskIntent: "question",
      interactionIntent: "question",
      taskAnalysis: {
        scope: "repository",
        complexity: "trivial",
        risk: "low",
        recommendsRepositoryDiscovery: true,
        recommendsVerification: false,
      },
    }),
    expected: {
      route: "answer",
      maximumWorkspaceEffect: "read",
    },
  },
  {
    id: "architecture_migration",
    category: "architecture",
    mode: "agent",
    message: "Migrate the legacy indexing pipeline across the repository.",
    understanding: createUnderstanding({
      primaryTaskIntent: "migrate",
      taskAnalysis: {
        scope: "repository",
        complexity: "very_complex",
        risk: "high",
        recommendsPlanning: true,
        estimatedFilesAffected: { minimum: 20 },
      },
    }),
    expected: {
      route: "execute",
      planningDepth: "visible",
      maximumWorkspaceEffect: "write",
    },
  },
  {
    id: "ambiguous_target",
    category: "ambiguous",
    mode: "agent",
    message: "Fix it.",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      confidence: 0.35,
      confidenceMargin: 0.05,
      needsClarification: true,
      recommendsClarification: true,
      status: "clarification_required",
      taskAnalysis: {
        clarity: "unclear",
        recommendsTaskClarification: true,
        scope: "unknown",
        complexity: "simple",
        risk: "medium",
      },
    }),
    expected: {
      route: "clarify",
      runDisposition: "clarification_required",
      maximumWorkspaceEffect: "none",
    },
  },
];
