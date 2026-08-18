import type { MemoryFact, MemoryFactDraft, MemoryRetrieveInput } from "../..";
import { MEMORY_SCHEMA_VERSION } from "../..";

export interface MemoryEvalCase {
  id: string;
  category:
    | "relevant"
    | "stale"
    | "privacy"
    | "irrelevant"
    | "budget"
    | "scope";
  input: Omit<MemoryRetrieveInput, "schemaVersion">;
  expectedRelevantIds: readonly string[];
  forbiddenIds: readonly string[];
  /** Expired facts that must be filtered (never selected). */
  staleIds?: readonly string[];
}

const NOW = "2026-07-26T12:00:00.000Z";

export const MEMORY_EVAL_SEED: readonly MemoryFactDraft[] = [
  {
    id: "m-pnpm",
    content: "This workspace uses pnpm for package management.",
    scope: { kind: "workspace", workspaceId: "ws" },
    tags: ["pnpm", "package"],
    privacy: "shareable",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-vitest",
    content: "Prefer vitest for unit tests in this project.",
    scope: { kind: "project", projectId: "proj" },
    tags: ["vitest", "test"],
    privacy: "shareable",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-stale-pnpm",
    content: "Old note: this workspace preferred yarn.",
    scope: { kind: "workspace", workspaceId: "ws" },
    tags: ["pnpm", "yarn", "package"],
    privacy: "shareable",
    createdAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-private-alice",
    content: "Alice private note about pnpm auth token rotation.",
    scope: { kind: "user", userId: "alice" },
    tags: ["pnpm", "auth"],
    privacy: "private",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-design",
    content: "The team prefers blue logos and serif headlines.",
    scope: { kind: "workspace", workspaceId: "ws" },
    tags: ["design", "logo"],
    privacy: "shareable",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-other-ws",
    content: "Other workspace uses npm exclusively.",
    scope: { kind: "workspace", workspaceId: "other" },
    tags: ["npm", "package"],
    privacy: "shareable",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-huge",
    content: "Y".repeat(4_000),
    scope: { kind: "workspace", workspaceId: "ws" },
    tags: ["pnpm", "package"],
    privacy: "shareable",
    createdAt: "2026-07-01T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-button",
    content: "Always use src/ui/Button.tsx. Never raw HTML button elements.",
    scope: { kind: "workspace", workspaceId: "ws" },
    type: "preference",
    concepts: ["button", "ui"],
    files: ["src/ui/Button.tsx", "src/LoginForm.tsx"],
    privacy: "shareable",
    createdAt: "2026-07-10T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-login-validation",
    content:
      "LoginForm already validates email and password. Do not rewrite validation.",
    scope: { kind: "workspace", workspaceId: "ws" },
    type: "fact",
    concepts: ["login", "validation"],
    files: ["src/LoginForm.tsx"],
    privacy: "shareable",
    createdAt: "2026-07-10T00:00:00.000Z",
    source: "user",
  },
  {
    id: "m-reject-react-query",
    content:
      "Login stays on fetch in src/api/auth.ts. React Query was rejected.",
    scope: { kind: "workspace", workspaceId: "ws" },
    type: "workflow",
    concepts: ["login", "react-query"],
    files: ["src/api/auth.ts", "src/LoginForm.tsx"],
    privacy: "shareable",
    createdAt: "2026-07-12T00:00:00.000Z",
    source: "user",
  },
];

export const MEMORY_EVALUATION_CASES: readonly MemoryEvalCase[] = [
  {
    id: "workspace_pnpm_relevant",
    category: "relevant",
    input: {
      query: "install packages with pnpm",
      scope: { kind: "workspace", workspaceId: "ws" },
      now: NOW,
    },
    expectedRelevantIds: ["m-pnpm"],
    forbiddenIds: ["m-design", "m-other-ws", "m-stale-pnpm", "m-private-alice"],
    staleIds: ["m-stale-pnpm"],
  },
  {
    id: "project_vitest_relevant",
    category: "relevant",
    input: {
      query: "run unit tests with vitest",
      scope: { kind: "project", projectId: "proj" },
      now: NOW,
    },
    expectedRelevantIds: ["m-vitest"],
    forbiddenIds: ["m-pnpm", "m-design", "m-stale-pnpm"],
  },
  {
    id: "stale_never_selected",
    category: "stale",
    input: {
      query: "package manager pnpm yarn preference",
      scope: { kind: "workspace", workspaceId: "ws" },
      now: NOW,
    },
    expectedRelevantIds: ["m-pnpm"],
    forbiddenIds: ["m-stale-pnpm", "m-design"],
    staleIds: ["m-stale-pnpm"],
  },
  {
    id: "privacy_blocks_other_user",
    category: "privacy",
    input: {
      query: "pnpm auth token rotation",
      scope: { kind: "user", userId: "alice" },
      requesterUserId: "bob",
      now: NOW,
    },
    expectedRelevantIds: [],
    forbiddenIds: ["m-private-alice", "m-pnpm", "m-design"],
  },
  {
    id: "privacy_allows_owner",
    category: "privacy",
    input: {
      query: "pnpm auth token rotation",
      scope: { kind: "user", userId: "alice" },
      requesterUserId: "alice",
      now: NOW,
    },
    expectedRelevantIds: ["m-private-alice"],
    forbiddenIds: ["m-pnpm", "m-design"],
  },
  {
    id: "irrelevant_design_excluded",
    category: "irrelevant",
    input: {
      query: "pnpm package install scripts",
      scope: { kind: "workspace", workspaceId: "ws" },
      now: NOW,
    },
    expectedRelevantIds: ["m-pnpm"],
    forbiddenIds: ["m-design", "m-stale-pnpm", "m-other-ws"],
    staleIds: ["m-stale-pnpm"],
  },
  {
    id: "scope_mismatch_other_workspace",
    category: "scope",
    input: {
      query: "npm package management",
      scope: { kind: "workspace", workspaceId: "ws" },
      now: NOW,
    },
    expectedRelevantIds: [],
    forbiddenIds: ["m-other-ws", "m-design"],
  },
  {
    id: "budget_omits_huge",
    category: "budget",
    input: {
      query: "pnpm package management",
      scope: { kind: "workspace", workspaceId: "ws" },
      budgetTokens: 40,
      maxFacts: 5,
      now: NOW,
    },
    expectedRelevantIds: ["m-pnpm"],
    forbiddenIds: ["m-huge", "m-design", "m-stale-pnpm"],
    staleIds: ["m-stale-pnpm"],
  },
  {
    id: "loginform_file_targets_without_lexical_overlap",
    category: "relevant",
    input: {
      query:
        "When the user clicks Sign in, show a loading label and disable the control until the request finishes.",
      scope: { kind: "workspace", workspaceId: "ws" },
      fileTargets: ["src/LoginForm.tsx"],
      now: NOW,
    },
    expectedRelevantIds: ["m-button", "m-login-validation"],
    forbiddenIds: ["m-design", "m-other-ws", "m-stale-pnpm"],
    staleIds: ["m-stale-pnpm"],
  },
  {
    id: "test_synonym_hits_vitest",
    category: "relevant",
    input: {
      query: "Add a focused unit test nearby",
      scope: { kind: "project", projectId: "proj" },
      now: NOW,
    },
    expectedRelevantIds: ["m-vitest"],
    forbiddenIds: ["m-pnpm", "m-design"],
  },
  {
    id: "workflow_rejection_stays_out_of_unrelated_design_query",
    category: "irrelevant",
    input: {
      query: "pnpm package install scripts",
      scope: { kind: "workspace", workspaceId: "ws" },
      now: NOW,
    },
    expectedRelevantIds: ["m-pnpm"],
    forbiddenIds: [
      "m-design",
      "m-stale-pnpm",
      "m-other-ws",
      "m-reject-react-query",
    ],
    staleIds: ["m-stale-pnpm"],
  },
];

export function toRetrieveInput(
  fixture: MemoryEvalCase,
): MemoryRetrieveInput {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    ...fixture.input,
  };
}
