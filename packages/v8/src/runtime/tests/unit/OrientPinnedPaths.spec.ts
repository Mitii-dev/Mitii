import { describe, expect, it } from "vitest";

import { orientSituation } from "../../flow/steps/2-OrientSituation";
import type { StepContext } from "../../flow/steps/StepContext";
import { StoreManager } from "../../helpers/store";

function ctx(
  partial: Partial<StepContext["input"]> & { message: string },
): StepContext {
  return {
    store: StoreManager.create("orient-pin-test"),
    input: {
      message: partial.message,
      ...partial,
    },
    mode: "ask",
  };
}

describe("orientSituation pinnedPaths", () => {
  it("puts host pins into focus even when the message has no paths", () => {
    const pack = orientSituation(
      ctx({
        message: "explain this",
        pinnedPaths: ["packages/checks/src/builtins"],
      }),
    );
    expect(pack.scope.focusPaths).toContain("packages/checks/src/builtins");
  });

  it("keeps pins ahead of dirty-path noise", () => {
    const pack = orientSituation(
      ctx({
        message: "what is going on?",
        pinnedPaths: ["packages/v8/ARCHITECTURE.md"],
        host: {
          dirtyPaths: ["apps/desktop/src/a.ts", "apps/desktop/src/b.ts"],
        },
      }),
    );
    expect(pack.scope.focusPaths[0]).toBe("packages/v8/ARCHITECTURE.md");
  });

  it("drops .mitii and other host internals from focus", () => {
    const pack = orientSituation(
      ctx({
        message: "explain pins",
        pinnedPaths: ["cases", ".mitii"],
        host: {
          dirtyPaths: [".mitii/logs/x.jsonl", "cases/README.md"],
        },
      }),
    );
    expect(pack.scope.focusPaths).toContain("cases");
    expect(pack.scope.focusPaths).toContain("cases/README.md");
    expect(pack.scope.focusPaths.some((p) => p.includes(".mitii"))).toBe(
      false,
    );
  });
});
