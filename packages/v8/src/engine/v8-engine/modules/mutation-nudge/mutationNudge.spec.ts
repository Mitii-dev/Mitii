import { describe, expect, it } from "vitest";

import {
  softMutationNudgeMessage,
  requiresMutation,
  batchIsReadonlyTools,
} from "./index";
import { createDecision, createReadOnlyGrant } from "../../tests/fixtures/stubs";

describe("mutationNudge", () => {
  it("detects execute+write as requiring mutation", () => {
    expect(
      requiresMutation(
        createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch"],
            allowedEffects: ["workspace_write"],
          }),
        }),
      ),
    ).toBe(true);
    expect(requiresMutation(createDecision({ route: "direct_answer" }))).toBe(
      false,
    );
  });

  it("classifies readonly batches", () => {
    expect(
      batchIsReadonlyTools([
        { id: "1", name: "read_file", arguments: "{}" },
        { id: "2", name: "search_files", arguments: "{}" },
      ]),
    ).toBe(true);
    expect(
      batchIsReadonlyTools([
        { id: "1", name: "apply_patch", arguments: "{}" },
      ]),
    ).toBe(false);
  });

  it("builds a soft mutation nudge without spending evidence language", () => {
    const message = softMutationNudgeMessage(12);
    expect(message).toContain("12 read-only");
    expect(message).toContain("apply_patch");
    expect(message.toLowerCase()).not.toContain("evidence");
  });
});
