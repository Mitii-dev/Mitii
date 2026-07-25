import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_MODES,
  agentModeSchema,
} from "../index";

test(
  "interaction mode accepts only ask, plan, and agent",
  () => {
    assert.deepEqual(
      AGENT_MODES,
      [
        "ask",
        "plan",
        "agent",
      ],
    );

    for (
      const mode of
      AGENT_MODES
    ) {
      assert.equal(
        agentModeSchema
          .parse(mode),
        mode,
      );
    }

    assert.equal(
      agentModeSchema
        .safeParse(
          "review",
        )
        .success,
      false,
    );
  },
);
