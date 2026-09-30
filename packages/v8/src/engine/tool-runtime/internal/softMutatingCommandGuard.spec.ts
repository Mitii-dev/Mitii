import { describe, expect, it } from "vitest";

import { CommandPolicyError } from "./CommandPolicy";
import {
  assertNoTempScriptWriteHelper,
  assertSoftNonMutatingCommand,
} from "./softMutatingCommandGuard";

describe("assertSoftNonMutatingCommand", () => {
  it("allows read-only git and package scripts", () => {
    expect(() =>
      assertSoftNonMutatingCommand(["git", "status"]),
    ).not.toThrow();
    expect(() =>
      assertSoftNonMutatingCommand(["git", "diff", "--", "src"]),
    ).not.toThrow();
    expect(() =>
      assertSoftNonMutatingCommand(["pnpm", "run", "test"]),
    ).not.toThrow();
  });

  it("rejects file-mutating commands", () => {
    expect(() => assertSoftNonMutatingCommand(["rm", "-rf", "src"])).toThrow(
      CommandPolicyError,
    );
    expect(() =>
      assertSoftNonMutatingCommand(["mv", "a.ts", "b.ts"]),
    ).toThrow(CommandPolicyError);
    expect(() =>
      assertSoftNonMutatingCommand(["sed", "-i", "s/a/b/", "file.ts"]),
    ).toThrow(CommandPolicyError);
  });

  it("rejects mutating git and package-manager subcommands", () => {
    expect(() =>
      assertSoftNonMutatingCommand(["git", "commit", "-am", "x"]),
    ).toThrow(/soft file-edit guard/i);
    expect(() =>
      assertSoftNonMutatingCommand(["npm", "install", "lodash"]),
    ).toThrow(/soft file-edit guard/i);
  });

  it("rejects output redirection tokens", () => {
    expect(() =>
      assertSoftNonMutatingCommand(["echo", "hi", ">", "out.txt"]),
    ).toThrow(/redirect/i);
  });

  it("rejects temp script write helpers", () => {
    expect(() =>
      assertSoftNonMutatingCommand(["bun", ".tmp-fix-sidebar.js"]),
    ).toThrow(/temp\/script write helper/i);
    expect(() =>
      assertNoTempScriptWriteHelper([
        "npm",
        "exec",
        "--yes",
        "--",
        "node",
        ".tmp-fix-sidebar.js",
      ]),
    ).toThrow(/temp\/script write helper/i);
    expect(() =>
      assertNoTempScriptWriteHelper(["node", "scripts/build.js"]),
    ).not.toThrow();
  });
});
