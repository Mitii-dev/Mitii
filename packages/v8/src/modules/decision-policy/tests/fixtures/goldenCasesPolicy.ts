import type { GoldenDecisionCase } from "./decisionFixtureTypes";
import {
  createTarget,
  createUnderstanding,
} from "./decisionFixtureHelpers";

/** Golden cases: grants, network, mode, risk and budget. */
export const GOLDEN_DECISION_CASES_POLICY: GoldenDecisionCase[] = [
  // --- Grants ---
  {
    id: "golden-grant-scoped-mutation",
    category: "grant",
    mode: "agent",
    message: "Only edit under src/utils — update src/utils/format.ts",
    understanding: createUnderstanding({
      primaryTaskIntent: "refactor",
      taskAnalysis: {
        scope: "single_location",
        recommendsRepositoryDiscovery: false,
        targets: [createTarget("src/utils/format.ts")],
      },
    }),
    expected: {
      route: "execute",
      maximumWorkspaceEffect: "write",
      pathScopes: ["."],
      mutationPathScopes: ["src/utils"],
    },
  },
  {
    id: "golden-grant-dependency-root-scope",
    category: "grant",
    mode: "agent",
    message: "Bump lodash in package.json",
    understanding: createUnderstanding({
      primaryTaskIntent: "dependency",
      taskAnalysis: {
        scope: "single_location",
        targets: [createTarget("package.json")],
      },
    }),
    expected: {
      route: "execute",
      pathScopes: ["."],
    },
  },
  {
    id: "golden-grant-no-run-command-without-verification",
    category: "grant",
    mode: "agent",
    message: "Shouws loading... LoginForm nbot working on https://localhost:3000/",
    understanding: createUnderstanding({
      primaryTaskIntent: "question",
      interactionIntent: "question",
      taskAnalysis: {
        scope: "unknown",
        recommendsVerification: false,
        recommendsRepositoryDiscovery: false,
      },
    }),
    expected: {
      route: "execute",
      allowedToolsExcludes: ["run_command"],
    },
  },
  {
    id: "golden-grant-run-command-with-verification",
    category: "grant",
    mode: "agent",
    message: "Fix bug in src/x.ts and make sure it builds",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        recommendsVerification: true,
        targets: [createTarget("src/x.ts")],
      },
    }),
    expected: {
      route: "execute",
      allowedToolsIncludes: ["run_command"],
      reasonCodesIncludes: ["process_execution_granted"],
    },
  },

  // --- Network / web search ---
  {
    id: "golden-network-web-search-enabled",
    category: "network",
    mode: "ask",
    message: "Search the web for Next.js 15 error boundaries",
    hostCapabilities: { webSearch: true },
    understanding: createUnderstanding({
      primaryTaskIntent: "docs",
      interactionIntent: "question",
      taskAnalysis: { scope: "unknown", recommendsRepositoryDiscovery: false },
    }),
    expected: {
      route: "answer",
      allowedToolsIncludes: ["web_search", "fetch_url"],
      reasonCodesIncludes: ["network_access_granted"],
    },
  },
  {
    id: "golden-network-web-search-disabled",
    category: "network",
    mode: "ask",
    message: "Search the web for Next.js 15 error boundaries",
    hostCapabilities: { webSearch: false },
    understanding: createUnderstanding({
      primaryTaskIntent: "docs",
      interactionIntent: "question",
      taskAnalysis: { scope: "unknown", recommendsRepositoryDiscovery: false },
    }),
    expected: {
      route: "answer",
      allowedToolsExcludes: ["web_search"],
    },
  },
  {
    id: "golden-network-live-web-product-compat",
    category: "network",
    mode: "ask",
    message:
      "Need Zebra ZP450 software compatible with Windows 11",
    hostCapabilities: { webSearch: true },
    understanding: createUnderstanding({
      primaryTaskIntent: "question",
      interactionIntent: "question",
      taskAnalysis: { scope: "unknown", recommendsRepositoryDiscovery: false },
    }),
    expected: {
      route: "answer",
      allowedToolsIncludes: ["web_search", "fetch_url"],
      reasonCodesIncludes: ["network_access_granted"],
    },
  },
  {
    id: "golden-network-live-web-product-compat-disabled",
    category: "network",
    mode: "ask",
    message:
      "Need Zebra ZP450 software compatible with Windows 11",
    hostCapabilities: { webSearch: false },
    understanding: createUnderstanding({
      primaryTaskIntent: "question",
      interactionIntent: "question",
      taskAnalysis: { scope: "unknown", recommendsRepositoryDiscovery: false },
    }),
    expected: {
      route: "answer",
      allowedToolsExcludes: ["web_search"],
    },
  },
  {
    id: "golden-network-in-repo-question-no-search",
    category: "network",
    mode: "ask",
    message: "What does this function in src/auth.ts do?",
    hostCapabilities: { webSearch: true },
    understanding: createUnderstanding({
      primaryTaskIntent: "question",
      interactionIntent: "question",
      taskAnalysis: {
        scope: "single_location",
        recommendsRepositoryDiscovery: true,
        targets: [createTarget("src/auth.ts")],
      },
    }),
    expected: {
      route: "answer",
      allowedToolsExcludes: ["web_search"],
    },
  },
  {
    id: "golden-network-url-fetch-execute",
    category: "network",
    mode: "agent",
    message: "Check rules at https://eslint.org/docs/latest/rules/ and apply them",
    understanding: createUnderstanding({
      primaryTaskIntent: "config",
      interactionIntent: "act",
      taskAnalysis: {
        scope: "single_location",
        targets: [createTarget(".eslintrc.json")],
      },
    }),
    expected: {
      route: "execute",
      allowedToolsIncludes: ["fetch_url"],
      reasonCodesIncludes: ["network_access_granted", "mutation_execute"],
    },
  },
  {
    id: "golden-network-localhost-excluded",
    category: "network",
    mode: "agent",
    message: "Fetch configuration from http://localhost:8080/config.json and update settings",
    understanding: createUnderstanding({
      primaryTaskIntent: "config",
      interactionIntent: "act",
      taskAnalysis: { scope: "single_location" },
    }),
    expected: {
      route: "execute",
      reasonCodesExcludes: ["network_access_granted"],
    },
  },

  // --- Mode ---
  {
    id: "golden-mode-plan-no-mutation",
    category: "mode",
    mode: "plan",
    message: "Add dark mode support across components",
    understanding: createUnderstanding({
      primaryTaskIntent: "feature",
      interactionIntent: "plan",
      taskAnalysis: { scope: "multi_file", complexity: "moderate" },
    }),
    expected: {
      route: "plan",
      maximumWorkspaceEffect: "read",
      allowedToolsExcludes: ["apply_patch", "run_command"],
      reasonCodesIncludes: ["mode_plan_only"],
    },
  },

  // --- Risk ---
  {
    id: "golden-risk-critical-every-mutation",
    category: "risk",
    mode: "agent",
    message: "Drop unused production database tables in migration script",
    understanding: createUnderstanding({
      primaryTaskIntent: "schema",
      taskAnalysis: {
        scope: "repository",
        complexity: "complex",
        risk: "critical",
        targets: [createTarget("migrations/002_drop.sql")],
      },
    }),
    expected: {
      route: "execute",
      approvalMode: "every_mutation",
      reasonCodesIncludes: ["high_risk_approval"],
    },
  },
  {
    id: "golden-risk-host-approval-never",
    category: "risk",
    mode: "agent",
    message: "Delete legacy deployment configs",
    approvalMode: "never",
    understanding: createUnderstanding({
      primaryTaskIntent: "config",
      taskAnalysis: {
        scope: "single_location",
        risk: "high",
        targets: [createTarget("deploy/legacy.yaml")],
      },
    }),
    expected: {
      route: "execute",
      approvalMode: "never",
    },
  },

  // --- Budget ---
  {
    id: "golden-budget-refactor-tight",
    category: "budget",
    mode: "agent",
    message: "Refactor auth middleware across 3 routes",
    understanding: createUnderstanding({
      primaryTaskIntent: "refactor",
      taskAnalysis: {
        scope: "multi_file",
        complexity: "moderate",
        estimatedFilesAffected: { minimum: 3, maximum: 3 },
      },
    }),
    expected: {
      route: "execute",
      reasonCodesIncludes: ["mutation_budget_tight"],
    },
  },
  {
    id: "golden-budget-localized-relaxed",
    category: "budget",
    mode: "agent",
    message: "Fix typo in src/constants.ts",
    understanding: createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        targets: [createTarget("src/constants.ts")],
      },
    }),
    expected: {
      route: "execute",
      reasonCodesIncludes: ["mutation_budget_relaxed"],
    },
  },
];
