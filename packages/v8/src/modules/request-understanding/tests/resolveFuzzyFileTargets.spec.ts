import { describe, expect, it } from "vitest";

import { resolveFuzzyFileTargets } from "../task-analyzer/analyzer/resolveFuzzyFileTargets";

describe("resolveFuzzyFileTargets", () => {
  const candidates = [
    "test/shared/config/testConfig.ts",
    "test/shared/session/Desktop.ts",
    "test/Desktop/pages/BillPage.ts",
    "test/specs/Desktop/regression/Billing/billing.spec.ts",
    "package.json",
  ];

  it("resolves unique basename hits", () => {
    const result = resolveFuzzyFileTargets(
      [
        {
          kind: "file",
          value: "Desktop.ts",
          explicit: true,
        },
        {
          kind: "file",
          value: "billing.spec.ts",
          explicit: true,
        },
      ],
      candidates,
    );

    expect(result.targets.map((t) => t.value)).toEqual([
      "test/shared/session/Desktop.ts",
      "test/specs/Desktop/regression/Billing/billing.spec.ts",
    ]);
    expect(result.resolved).toHaveLength(2);
  });

  it("keeps ambiguous basenames unchanged", () => {
    const result = resolveFuzzyFileTargets(
      [{ kind: "file", value: "index.ts", explicit: true }],
      ["src/index.ts", "lib/index.ts"],
    );
    expect(result.targets[0]?.value).toBe("index.ts");
    expect(result.resolved).toHaveLength(0);
  });

  it("keeps exact relative paths", () => {
    const result = resolveFuzzyFileTargets(
      [
        {
          kind: "file",
          value: "test/shared/config/testConfig.ts",
          explicit: true,
        },
      ],
      candidates,
    );
    expect(result.targets[0]?.value).toBe("test/shared/config/testConfig.ts");
    expect(result.resolved).toHaveLength(0);
  });

  it("can correct a prior sparse wrong lock when richer candidates appear", () => {
    // Early dirty-only pass might have locked config.ts → src/config.ts.
    // A later pass with repo-map candidates must be able to leave an already
    // full path alone when it still uniquely matches, and must not expand
    // when ambiguous — callers defer expansion until rich candidates exist.
    const locked = resolveFuzzyFileTargets(
      [{ kind: "file", value: "config.ts", explicit: true }],
      ["src/config.ts"],
    );
    expect(locked.targets[0]?.value).toBe("src/config.ts");

    const withRepoMap = resolveFuzzyFileTargets(
      [{ kind: "file", value: "config.ts", explicit: true }],
      ["src/config.ts", "lib/config.ts", "packages/app/config.ts"],
    );
    expect(withRepoMap.targets[0]?.value).toBe("config.ts");
    expect(withRepoMap.resolved).toHaveLength(0);
  });

  it("resolves unique extensionless PascalCase stems", () => {
    const result = resolveFuzzyFileTargets(
      [{ kind: "file", value: "Desktop", explicit: true }],
      candidates,
    );
    expect(result.targets[0]?.value).toBe("test/shared/session/Desktop.ts");
    expect(result.resolved).toHaveLength(1);
  });

  it("resolves unique CamelCase identifier-term stems", () => {
    const result = resolveFuzzyFileTargets(
      [{ kind: "file", value: "BillPage", explicit: true }],
      candidates,
    );
    expect(result.targets[0]?.value).toBe("test/Desktop/pages/BillPage.ts");
  });

  it("resolves a unique identifier part against a longer PascalCase stem", () => {
    const result = resolveFuzzyFileTargets(
      [{ kind: "file", value: "Kanban", explicit: true }],
      [
        "src/features/DinInKanban.tsx",
        "src/shared/session/Desktop.ts",
        "package.json",
      ],
    );
    expect(result.targets[0]?.value).toBe("src/features/DinInKanban.tsx");
  });

  it("does not match short identifier parts as path substrings", () => {
    // "bill" must not resolve via substring into "billing.spec.ts".
    const result = resolveFuzzyFileTargets(
      [{ kind: "file", value: "Bill", explicit: true }],
      [
        "test/specs/Desktop/regression/Billing/billing.spec.ts",
        "src/other.ts",
      ],
    );
    expect(result.targets[0]?.value).toBe("Bill");
    expect(result.resolved).toHaveLength(0);
  });

  it("keeps ambiguous CamelCase stems unchanged", () => {
    const result = resolveFuzzyFileTargets(
      [{ kind: "file", value: "Desktop", explicit: true }],
      [
        "test/shared/session/Desktop.ts",
        "apps/web/Desktop.tsx",
      ],
    );
    expect(result.targets[0]?.value).toBe("Desktop");
    expect(result.resolved).toHaveLength(0);
  });
});
