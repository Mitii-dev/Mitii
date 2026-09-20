import { describe, expect, it } from "vitest";

import {
  InMemorySessionHistoryArchive,
  looksReferentialSessionQuery,
  resolveSessionHistoryProjectionBudgetChars,
  retrieveSessionHistory,
  SESSION_HISTORY_PROJECTION_MARKERS,
  tokenizeQuery,
} from "./index";
import type { ModelMessage } from "../../../../modules/model-gateway";

describe("Session History formulae (OpenCode dual-store + Mitii hybrid)", () => {
  it("archives dropped turns without deleting them from the durable store", () => {
    const archive = new InMemorySessionHistoryArchive();
    const dropped: ModelMessage[] = [
      {
        role: "assistant",
        content: "Loading must live in useLoginMutation in src/hooks/useAuth.ts",
        toolCalls: [
          {
            id: "c1",
            name: "read_file",
            arguments: JSON.stringify({ path: "src/hooks/useAuth.ts" }),
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "c1",
        content: JSON.stringify({
          toolName: "read_file",
          finding: "export function useLoginMutation",
          locator: { path: "src/hooks/useAuth.ts" },
        }),
      },
    ];
    const records = archive.archiveDroppedMessages({
      dropped,
      nowMs: 1_000,
      runId: "run_1",
    });
    expect(records.length).toBe(2);
    expect(archive.size()).toBe(2);
    expect(records[0]?.locators).toContain("src/hooks/useAuth.ts");
    // Second compaction generation still keeps prior records (OpenCode dual-store).
    archive.archiveDroppedMessages({
      dropped: [{ role: "user", content: "also fix the flaky test" }],
      nowMs: 2_000,
      runId: "run_1",
    });
    expect(archive.size()).toBe(3);
    expect(archive.currentCompactionGeneration()).toBe(2);
  });

  it("detects referential follow-ups that need archive recall", () => {
    expect(
      looksReferentialSessionQuery(
        "Earlier you said loading should live in the hook — remind me which file.",
      ),
    ).toBe(true);
    expect(looksReferentialSessionQuery("read src/LoginForm.tsx")).toBe(false);
  });

  it("hybrid-retrieves query-relevant archived turns under budget", () => {
    const archive = new InMemorySessionHistoryArchive();
    archive.archiveDroppedMessages({
      dropped: [
        {
          role: "assistant",
          content:
            "Loading state must live in useLoginMutation (src/hooks/useAuth.ts); AuthProvider owns isPending.",
        },
        {
          role: "user",
          content: "Also fix the flaky waitFor race in LoginForm.test.tsx",
        },
        {
          role: "assistant",
          content: "Unrelated note about prettier config in the repo root.",
        },
      ],
      nowMs: 10,
      runId: "run_login",
    });

    const budget = resolveSessionHistoryProjectionBudgetChars({
      conversationTokens: 2_000,
      droppedTurnSummaryChars: 1_500,
    });
    expect(budget).toBeGreaterThanOrEqual(800);

    const result = retrieveSessionHistory({
      archive: archive.list(),
      query:
        "Earlier you said loading state should live in the hook, not the form. Which file owned isPending?",
      budgetChars: budget,
      force: true,
    });

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.projectionText).toContain(
      SESSION_HISTORY_PROJECTION_MARKERS.start,
    );
    expect(result.projectionText).toMatch(/useLoginMutation|useAuth/i);
    // Prefer the loading-state turn over prettier noise.
    const top = result.hits[0]!;
    expect(top.record.content).toMatch(/useLoginMutation|isPending/i);
  });

  it("returns empty when archive is empty or query is too short", () => {
    const archive = new InMemorySessionHistoryArchive();
    expect(
      retrieveSessionHistory({
        archive: archive.list(),
        query: "earlier you said loading",
        budgetChars: 2_000,
        force: true,
      }).hits,
    ).toHaveLength(0);
    archive.archiveDroppedMessages({
      dropped: [{ role: "user", content: "hello world enough text here" }],
      nowMs: 1,
      runId: "r",
    });
    expect(
      retrieveSessionHistory({
        archive: archive.list(),
        query: "hi",
        budgetChars: 2_000,
        force: true,
      }).hits,
    ).toHaveLength(0);
  });

  it("tokenizes queries for lexical stream", () => {
    expect(tokenizeQuery("useLoginMutation in src/hooks/useAuth.ts")).toEqual(
      expect.arrayContaining(["useloginmutation", "src/hooks/useauth.ts"]),
    );
  });
});
