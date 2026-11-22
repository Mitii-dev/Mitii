import { describe, expect, it } from "vitest";

import {
  CONTEXT_EPOCH_BODY_POLICY,
  buildInstructionSourceState,
  formatInstructionSourceUpdate,
  truncateMidConversationUpdateText,
} from "./instructionSourceBodies";

describe("instructionSourceBodies", () => {
  it("changes digest when bodies change with stable ids", () => {
    const ids = ["environment-details"];
    const a = buildInstructionSourceState(ids, {
      "environment-details": "files: a.ts",
    });
    const b = buildInstructionSourceState(ids, {
      "environment-details": "files: b.ts",
    });
    expect(a.ids).toEqual(b.ids);
    expect(a.digest).not.toBe(b.digest);
  });

  it("prefers added ids when formatting updates", () => {
    const previous = buildInstructionSourceState(["a"], { a: "old" });
    const current = buildInstructionSourceState(["a", "b"], {
      a: "old",
      b: "brand new skill body",
    });
    const text = formatInstructionSourceUpdate({
      kind: "skills",
      previous,
      current,
      bodies: { a: "old", b: "brand new skill body" },
    });
    expect(text.indexOf("### b")).toBeLessThan(text.indexOf("### a"));
    expect(text).toContain("brand new skill body");
  });

  it("truncates mid-conversation update text to policy cap", () => {
    const huge = "x".repeat(
      CONTEXT_EPOCH_BODY_POLICY.midConversationUpdateMaxChars + 500,
    );
    const truncated = truncateMidConversationUpdateText(huge);
    expect(truncated.length).toBe(
      CONTEXT_EPOCH_BODY_POLICY.midConversationUpdateMaxChars,
    );
    expect(truncated.endsWith("…")).toBe(true);
  });
});
