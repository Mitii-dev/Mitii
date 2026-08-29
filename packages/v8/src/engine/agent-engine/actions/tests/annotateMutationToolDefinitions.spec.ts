import { describe, expect, it } from "vitest";

import { annotateMutationToolDefinitions } from "../annotateMutationToolDefinitions";

describe("annotateMutationToolDefinitions", () => {
  it("rewrites apply_patch catalog text from the live mutation grant", () => {
    const tools = annotateMutationToolDefinitions(
      [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object" },
        },
        {
          name: "apply_patch",
          description: "Apply structured patches. Prefer 3 files per call.",
          inputSchema: { type: "object" },
        },
      ],
      {
        maxPatchesPerCall: 16,
        maxUniqueFilesPerCall: 8,
        maxPatchPayloadCharacters: 32_000,
        preferredBatchSize: 8,
        requireBatchedExecution: true,
      },
    );

    expect(tools[0]?.description).toBe("Read a file");
    expect(tools[1]?.description).toContain("Prefer 8 files per call");
    expect(tools[1]?.description).toContain("hard max 8 unique files");
    expect(tools[1]?.description).toContain("old_text_not_found");
    expect(tools[1]?.description).not.toContain("Prefer 3 files");
  });
});
