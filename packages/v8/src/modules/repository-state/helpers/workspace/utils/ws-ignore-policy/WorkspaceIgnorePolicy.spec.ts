import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceIgnorePolicy } from "./WorkspaceIgnorePolicy";

test(
  "default policy ignores package manager artifacts and runtime logs",
  () => {
    const policy =
      new WorkspaceIgnorePolicy();

    assert.equal(
      policy.shouldIgnore({
        path:
          "/workspace/.pnp.cjs",
        relativePath:
          ".pnp.cjs",
        kind:
          "file",
        depth:
          1,
        root:
          "/workspace",
      }),
      true,
    );
    assert.equal(
      policy.shouldIgnore({
        path:
          "/workspace/logs",
        relativePath:
          "logs",
        kind:
          "directory",
        depth:
          1,
        root:
          "/workspace",
      }),
      true,
    );
    assert.equal(
      policy.shouldIgnore({
        path:
          "/workspace/src/index.ts",
        relativePath:
          "src/index.ts",
        kind:
          "file",
        depth:
          2,
        root:
          "/workspace",
      }),
      false,
    );
  },
);
