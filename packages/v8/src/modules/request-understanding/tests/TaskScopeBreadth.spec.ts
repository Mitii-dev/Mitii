import { describe, expect, it } from "vitest";

import { TaskScopeAnalyzer } from "../task-analyzer/analyzer/TaskScopeAnalyzer";
import { TASK_ANALYZER_CONSTANTS } from "../task-analyzer/constants";

describe("repository scope breadth (plan-gate input)", () => {
  const pattern = TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.REPOSITORY_SCOPE_PATTERN;
  const analyzer = new TaskScopeAnalyzer();

  it("matches explicit breadth language", () => {
    expect(pattern.test("Refactor auth across the codebase")).toBe(true);
    expect(pattern.test("Migrate production auth across the repository")).toBe(
      true,
    );
    expect(pattern.test("Update the entire application config surface")).toBe(
      true,
    );
    expect(pattern.test("Apply the change project-wide")).toBe(true);
    expect(pattern.test("Restructure this project")).toBe(true);
    expect(pattern.test("Need proper folder restructure as well")).toBe(true);
  });

  it("does not match locative or casual app/codebase references", () => {
    expect(
      pattern.test(
        "Build and unit-test the app instead of booting an HTTP server.",
      ),
    ).toBe(false);
    expect(
      pattern.test(
        "Helpers don't exist anywhere in this codebase — implement them.",
      ),
    ).toBe(false);
    expect(pattern.test("The app won't start. Please investigate.")).toBe(
      false,
    );
    expect(
      pattern.test(
        "Inject CartRepository the same way the repository is injected.",
      ),
    ).toBe(false);
  });

  it("keeps TaskScopeAnalyzer aligned with the breadth pattern", () => {
    expect(
      analyzer.estimateScope({
        userMessage: "Refactor authentication across the codebase.",
        targets: [],
      }),
    ).toBe("repository");

    expect(
      analyzer.estimateScope({
        userMessage:
          "Restructure this project, make sure tests follow interfaces\n- Need proper folder restructure as well",
        targets: [],
      }),
    ).toBe("repository");

    expect(
      analyzer.estimateScope({
        userMessage:
          "Helpers don't exist anywhere in this codebase — implement them with crypto.",
        targets: [],
      }),
    ).not.toBe("repository");
  });
});
