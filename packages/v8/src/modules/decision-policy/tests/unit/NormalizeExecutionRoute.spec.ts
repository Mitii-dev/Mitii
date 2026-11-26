import { describe, expect, it } from "vitest";

import {
  isAnswerRoute,
  normalizeExecutionRoute,
} from "../../helpers/NormalizeExecutionRoute";

describe("normalizeExecutionRoute", () => {
  it("maps legacy answer aliases to answer", () => {
    expect(normalizeExecutionRoute("direct_answer")).toBe("answer");
    expect(normalizeExecutionRoute("repository_answer")).toBe("answer");
    expect(normalizeExecutionRoute("answer")).toBe("answer");
  });

  it("passes through non-answer routes", () => {
    expect(normalizeExecutionRoute("execute")).toBe("execute");
    expect(normalizeExecutionRoute("clarify")).toBe("clarify");
  });
});

describe("isAnswerRoute", () => {
  it("accepts answer and legacy aliases", () => {
    expect(isAnswerRoute("answer")).toBe(true);
    expect(isAnswerRoute("direct_answer")).toBe(true);
    expect(isAnswerRoute("repository_answer")).toBe(true);
    expect(isAnswerRoute("execute")).toBe(false);
  });
});
