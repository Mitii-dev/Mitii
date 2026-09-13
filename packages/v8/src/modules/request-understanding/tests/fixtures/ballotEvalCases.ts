/**
 * Golden fixtures for Understanding Ballot + Decision Steering (Phase 0).
 * Behavior assertions land with later phases; these cases document expected outcomes.
 */

export type BallotEvalExpectation =
  | {
      kind: "route_or_clarify";
      /** Preferred route when confident enough to continue. */
      preferredRoutes: Array<
        | "direct_answer"
        | "repository_answer"
        | "clarify"
        | "diagnose"
        | "plan"
        | "execute"
      >;
      /** Must never silently take this route. */
      forbiddenSilentRoutes?: Array<"execute" | "diagnose">;
    }
  | {
      kind: "clarify_slot";
      slotKinds: Array<"interaction" | "target" | "scope" | "outcome" | "intent">;
    }
  | {
      kind: "skill_tags";
      /** Tags that should survive closed-vocab intersect when ballot v2 is on. */
      expectedTagsSubset?: string[];
      /** Tags that must be dropped. */
      droppedTags?: string[];
    };

export interface BallotEvalCase {
  id: string;
  description: string;
  mode: "ask" | "plan" | "agent";
  message: string;
  expectations: BallotEvalExpectation[];
}

export const BALLOT_EVAL_CASES: BallotEvalCase[] = [
  {
    id: "typo-loginform-mutation",
    description: "Spelling mistake should still classify as act/bugfix or clarify target",
    mode: "agent",
    message: "fix loginform submit loosing state on sign in",
    expectations: [
      {
        kind: "route_or_clarify",
        preferredRoutes: ["execute", "clarify", "diagnose"],
        forbiddenSilentRoutes: [],
      },
      { kind: "skill_tags", expectedTagsSubset: ["localize", "fix"] },
    ],
  },
  {
    id: "question-shaped-mutation-fork",
    description: "Can you fix that? without target — clarify, never silent broad execute",
    mode: "agent",
    message: "Can you fix that?",
    expectations: [
      {
        kind: "route_or_clarify",
        preferredRoutes: ["clarify", "diagnose"],
        forbiddenSilentRoutes: ["execute"],
      },
      { kind: "clarify_slot", slotKinds: ["target", "outcome", "intent", "interaction"] },
    ],
  },
  {
    id: "act-vs-explain-ambiguity",
    description: "Explain vs fix fork must clarify interaction when material",
    mode: "agent",
    message: "the login button is broken — thoughts?",
    expectations: [
      {
        kind: "route_or_clarify",
        preferredRoutes: ["clarify", "diagnose", "repository_answer"],
        forbiddenSilentRoutes: ["execute"],
      },
      { kind: "clarify_slot", slotKinds: ["interaction", "outcome"] },
    ],
  },
  {
    id: "dual-filename-ambiguity",
    description: "Two similar files — clarify target slot",
    mode: "agent",
    message: "update LoginForm loading state (LoginForm.tsx or LoginFrom.tsx?)",
    expectations: [
      {
        kind: "route_or_clarify",
        preferredRoutes: ["clarify", "execute"],
      },
      { kind: "clarify_slot", slotKinds: ["target"] },
    ],
  },
  {
    id: "paste-dump-diagnose",
    description: "Pasted stack without fix verb stays diagnose, not execute",
    mode: "agent",
    message: [
      "TypeError: Cannot read properties of undefined (reading 'map')",
      "    at ProductList (src/ProductList.tsx:42:18)",
      "    at renderWithHooks",
      "    at mountIndeterminateComponent",
    ].join("\n"),
    expectations: [
      {
        kind: "route_or_clarify",
        preferredRoutes: ["diagnose"],
        forbiddenSilentRoutes: ["execute"],
      },
    ],
  },
  {
    id: "open-vocab-tag-drop",
    description: "Freeform tags outside closed vocab must be dropped",
    mode: "agent",
    message: "fix null deref in auth service",
    expectations: [
      {
        kind: "skill_tags",
        expectedTagsSubset: ["localize", "fix"],
        droppedTags: ["please-be-careful-with-auth"],
      },
    ],
  },
];
