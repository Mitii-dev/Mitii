import { describe, expect, it } from "vitest";

import { buildRejectedMutationRecoveryMessage } from "../rejectedToolRecovery";

describe("buildRejectedMutationRecoveryMessage", () => {
  it("tells the model to send a real diff after identical_old_and_new", () => {
    const message = buildRejectedMutationRecoveryMessage({
      toolName: "apply_patch",
      status: "rejected",
      reasonCode: "identical_old_and_new",
      warnings: [
        'oldText and newText are identical for "src/a.ts" — this patch would not change the file.',
      ],
      summary: "patches=1 paths=src/a.ts",
      maxTargetedDiscoveryToolCalls: 4,
    });

    expect(message).toContain("identical_old_and_new");
    expect(message).toContain("file was not changed");
    expect(message).toContain("newText that actually differs");
    expect(message).toContain("at most 4 targeted read");
  });

  it("tells the model to retry apply_patch after host diagnostics source-file failures", () => {
    const message = buildRejectedMutationRecoveryMessage({
      toolName: "apply_patch",
      status: "failed",
      reasonCode: "execution_failed",
      warnings: [
        "Could not find source file: '/tmp/fixture/src/App.tsx'.",
      ],
      summary: "patches=1 paths=src/App.tsx",
    });

    expect(message).toContain("host diagnostics failure");
    expect(message).toContain('oldText=""');
    expect(message).not.toContain("copy exact oldText from that content");
    expect(message).toContain("Do not use mkdir");
  });
});
