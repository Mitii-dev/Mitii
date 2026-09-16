import { describe, expect, it } from "vitest";

import { ReviewPipeline, InMemoryReviewRecordStore } from "../../../../modules/review";
import { createAgentEngineReviewPort } from "../createAgentEngineReviewPort";

describe("createAgentEngineReviewPort", () => {
  it("prepare and finalize through the engine port", async () => {
    const store = new InMemoryReviewRecordStore();
    const pipeline = new ReviewPipeline({
      records: store,
      idGenerator: () => "eng-rec",
      clock: () => new Date("2026-01-02T00:00:00.000Z"),
    });
    const port = createAgentEngineReviewPort(pipeline);
    const input = {
      schemaVersion: 1 as const,
      workspaceId: "ws",
      files: [
        {
          path: "src/a.ts",
          content: "const a = 1;\n",
          diff: "",
          insertions: 1,
        },
      ],
    };
    const prep = port.prepare(input);
    expect(prep.selectedCount).toBe(1);
    const result = await port.finalize({
      input,
      prep,
      findings: [
        {
          path: "src/a.ts",
          content: "prefer const name",
          existingCode: "const a = 1;",
          category: "style",
          severity: "low",
          anchored: false,
        },
      ],
    });
    expect(result.recordId).toBe("eng-rec");
    expect(result.anchoredCount).toBe(1);
  });
});
