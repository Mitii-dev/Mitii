import { describe, expect, it, vi } from "vitest";

import { executeReadGitStatus } from "../actions/ExecuteReadGitStatus";
import { createReadOnlyGrant } from "./fixtures/grants";

describe("executeReadGitStatus diff coverage", () => {
  it("returns staged and unstaged changes together", async () => {
    const diff = vi
      .fn()
      .mockResolvedValueOnce({ diff: "diff --git a/staged.ts b/staged.ts", truncated: false })
      .mockResolvedValueOnce({ diff: "diff --git a/live.ts b/live.ts", truncated: false });

    const result = await executeReadGitStatus({
      arguments: { includeDiff: true },
      grant: createReadOnlyGrant(),
      workspaceRoot: "/workspace",
      git: {
        status: vi.fn().mockResolvedValue({
          branch: "main",
          staged: ["staged.ts"],
          unstaged: ["live.ts"],
          untracked: [],
          raw: "",
        }),
        diff,
      },
      maxOutputBytes: 256_000,
    });

    expect(diff).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ staged: true }),
    );
    expect(diff).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ staged: true }),
    );
    expect(result.output).toMatchObject({
      diff: expect.stringContaining("# Staged changes"),
      truncated: false,
    });
    expect((result.output as { diff: string }).diff).toContain(
      "# Unstaged changes",
    );
  });

  it("returns a staged-only patch instead of an empty diff", async () => {
    const result = await executeReadGitStatus({
      arguments: { includeDiff: true, paths: ["staged.ts"] },
      grant: createReadOnlyGrant(),
      workspaceRoot: "/workspace",
      git: {
        status: vi.fn().mockResolvedValue({
          staged: ["staged.ts"],
          unstaged: [],
          untracked: [],
          raw: "",
        }),
        diff: vi
          .fn()
          .mockResolvedValueOnce({ diff: "staged patch", truncated: false })
          .mockResolvedValueOnce({ diff: "", truncated: false }),
      },
      maxOutputBytes: 256_000,
    });

    expect(result.output).toMatchObject({
      diff: "# Staged changes\nstaged patch",
      truncated: false,
    });
  });
});
