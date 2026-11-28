import { describe, expect, it } from "vitest";

import {
  hasClarificationTail,
  normalizeRouteMessage,
} from "../../helpers/NormalizeRouteMessage";
import { looksLikeAgentExecuteContinue } from "../../helpers/RouteMessageSignals";

describe("normalizeRouteMessage", () => {
  it("strips host pin envelopes so continue signals stay short", () => {
    expect(
      normalizeRouteMessage(
        "User pinned these paths for this turn:\n- cases\n\ncontinue",
      ),
    ).toBe("continue");
  });

  it("strips Clarification tails", () => {
    expect(
      normalizeRouteMessage("continue\nClarification: use the tablet tab"),
    ).toBe("continue");
  });

  it("detects clarification tails", () => {
    expect(hasClarificationTail("fix it\nClarification: nav bar")).toBe(true);
    expect(hasClarificationTail("fix it")).toBe(false);
  });

  it("keeps looksLikeAgentExecuteContinue true for pin-prefixed continue", () => {
    expect(
      looksLikeAgentExecuteContinue(
        "User pinned these paths for this turn:\n- cases\n\ncontinue",
      ),
    ).toBe(true);
  });

  it("treats desktop verification-repair and plan-item Continue as execute", () => {
    expect(
      looksLikeAgentExecuteContinue(
        "Continue with verification repair: Address verification failures: node --test a.js",
      ),
    ).toBe(true);
    expect(
      looksLikeAgentExecuteContinue(
        "Continue with plan item 2/6: Session continuity",
      ),
    ).toBe(true);
  });
});
