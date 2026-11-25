import { describe, expect, it } from "vitest";

import { AGENT_MODES, agentModeSchema } from "../../index";

describe("interaction mode", () => {
  it("accepts only ask, plan, and agent", () => {
    expect(AGENT_MODES).toEqual(["ask", "plan", "agent"]);

    for (const mode of AGENT_MODES) {
      expect(agentModeSchema.parse(mode)).toBe(mode);
    }

    expect(agentModeSchema.safeParse("review").success).toBe(false);
  });
});
