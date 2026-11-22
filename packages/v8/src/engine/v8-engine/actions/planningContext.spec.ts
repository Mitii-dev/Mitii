import { describe, expect, it } from "vitest";

import {
  buildPlanningQuery,
  extractPriorPathHints,
  isPlanningFollowUp,
  looksLikeMultiItemPlanGuidance,
  mergeContextPathsWithPriorHints,
  resolveFollowUpPlanningTaskSize,
  resolvePriorPathHintBudget,
} from "./planningContext";

const MULTI_ITEM_ASSISTANT = `
**Verifiers present in packages/runner/src/verifiers.js**

| Verifier | Purpose |
|----------|---------|
| agent_exit | exit code |
| file_exists | path exists |
| command | shell check |

### Suggested improvements / gaps

| Area | What could be added |
|------|---------------------|
| Pattern matching | Add file_matches_regex |
| JSON schema | Validate configs |
| Parallel verification | Run checks concurrently |
| Timeout granularity | Per-check timeoutMs |
`;

describe("looksLikeMultiItemPlanGuidance", () => {
  it("detects improvement tables and bullet lists", () => {
    expect(looksLikeMultiItemPlanGuidance(MULTI_ITEM_ASSISTANT)).toBe(true);
    expect(
      looksLikeMultiItemPlanGuidance(
        [
          "- Add regex file content matching for flexible oracle checks",
          "- Introduce JSON schema validation for config fixtures",
          "- Allow parallel verification of independent check groups",
        ].join("\n"),
      ),
    ).toBe(true);
    expect(looksLikeMultiItemPlanGuidance("Change the label in App.tsx")).toBe(
      false,
    );
  });
});

describe("resolveFollowUpPlanningTaskSize", () => {
  it("bumps small follow-up Plan asks when prior guidance is multi-item", () => {
    expect(
      resolveFollowUpPlanningTaskSize({
        currentTaskSize: "small",
        currentQuery: "can you plan for the above implementation",
        conversation: [
          {
            role: "user",
            content: "how many verifiers do we have and what to improve",
          },
          { role: "assistant", content: MULTI_ITEM_ASSISTANT },
        ],
      }),
    ).toBe("medium");
  });

  it("keeps small for cold asks and non-multi-item follow-ups", () => {
    expect(
      resolveFollowUpPlanningTaskSize({
        currentTaskSize: "small",
        currentQuery: "plan adding a comment to src/a.ts",
        conversation: [],
      }),
    ).toBe("small");
    expect(
      resolveFollowUpPlanningTaskSize({
        currentTaskSize: "small",
        currentQuery: "can you plan for the above implementation",
        conversation: [
          { role: "user", content: "rename the helper in utils.ts" },
          {
            role: "assistant",
            content: "The helper lives in utils.ts around line 12.",
          },
        ],
      }),
    ).toBe("small");
  });

  it("does not downgrade medium/large", () => {
    expect(
      resolveFollowUpPlanningTaskSize({
        currentTaskSize: "large",
        currentQuery: "plan the above",
        conversation: [{ role: "user", content: "refactor auth" }],
      }),
    ).toBe("large");
  });
});

describe("buildPlanningQuery", () => {
  it("keeps more of the prior assistant guidance for planning grounding", () => {
    const query = buildPlanningQuery("can you plan for the above implementation", [
      {
        role: "user",
        content: "how many verifiers do we have and list what to improve",
      },
      { role: "assistant", content: MULTI_ITEM_ASSISTANT.repeat(3) },
    ]);
    expect(query).toMatch(/Follow-up:/);
    expect(query).toMatch(/Prior assistant guidance/);
    expect(query.length).toBeGreaterThan(1_200);
  });
});

describe("isPlanningFollowUp", () => {
  it("recognizes plan-the-above follow-ups", () => {
    expect(
      isPlanningFollowUp("can you plan for the above implementation", [
        { role: "user", content: "list improvements for verifiers" },
      ]),
    ).toBe(true);
  });
});

describe("extractPriorPathHints", () => {
  it("collects paths from assistant text and tool-call arguments", () => {
    const hints = extractPriorPathHints(
      [
        {
          role: "user",
          content: "how many verifiers in packages/runner/src/verifiers.js",
        },
        {
          role: "assistant",
          content: "Also see packages/runner/src/http-check.js",
          toolCalls: [
            {
              name: "read_file",
              arguments: JSON.stringify({
                path: "packages/runner/src/verifiers.js",
              }),
            },
          ],
        },
        {
          role: "tool",
          content: '{"path":"packages/runner/src/snapshot.js"}',
        },
      ],
      { max: 16 },
    );
    expect(hints).toEqual(
      expect.arrayContaining([
        "packages/runner/src/verifiers.js",
        "packages/runner/src/http-check.js",
        "packages/runner/src/snapshot.js",
      ]),
    );
  });
});

describe("mergeContextPathsWithPriorHints", () => {
  it("keeps prior Ask paths when retrieval collapses to one file", () => {
    expect(
      mergeContextPathsWithPriorHints({
        contextPaths: ["packages/runner/src/verifiers.js"],
        priorPathHints: [
          "packages/runner/src/verifiers.js",
          "packages/runner/src/http-check.js",
          "packages/runner/src/runner.js",
        ],
      }),
    ).toEqual([
      "packages/runner/src/verifiers.js",
      "packages/runner/src/http-check.js",
      "packages/runner/src/runner.js",
    ]);
  });
});

describe("resolvePriorPathHintBudget", () => {
  it("raises the budget for Plan follow-ups", () => {
    expect(
      resolvePriorPathHintBudget({
        currentQuery: "can you plan for the above implementation",
        conversation: [
          { role: "user", content: "list verifier improvements please" },
        ],
        mode: "plan",
      }),
    ).toBe(16);
    expect(
      resolvePriorPathHintBudget({
        currentQuery: "what is in App.tsx",
        conversation: [],
        mode: "ask",
      }),
    ).toBe(8);
  });
});
