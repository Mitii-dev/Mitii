import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_DETAILS_BLOCK_ID,
  formatEnvironmentDetailsBlock,
} from "./index.js";

describe("formatEnvironmentDetailsBlock", () => {
  it("returns undefined for an empty snapshot", () => {
    expect(formatEnvironmentDetailsBlock({})).toBeUndefined();
  });

  it("formats visible files, tabs, terminals, and mode", () => {
    const block = formatEnvironmentDetailsBlock({
      modeReminder: "Code (agent)",
      visibleFiles: ["src/a.ts", "src/b.ts"],
      openTabs: ["README.md"],
      terminalSummaries: ["zsh"],
      gitStatusSummary: "main…dirty",
    });
    expect(block?.id).toBe(ENVIRONMENT_DETAILS_BLOCK_ID);
    expect(block?.content).toContain("Active mode: Code (agent)");
    expect(block?.content).toContain("src/a.ts");
    expect(block?.content).toContain("README.md");
    expect(block?.content).toContain("zsh");
    expect(block?.content).toContain("main…dirty");
    expect(block?.priority).toBeGreaterThan(200);
  });

  it("clips long file lists", () => {
    const files = Array.from({ length: 100 }, (_, i) => `f${i}.ts`);
    const block = formatEnvironmentDetailsBlock(
      { visibleFiles: files },
      { maxFiles: 5 },
    );
    expect(block?.content.match(/- f\d+\.ts/g)?.length).toBe(5);
  });
});
