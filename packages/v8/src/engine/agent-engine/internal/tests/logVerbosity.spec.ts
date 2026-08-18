import { describe, expect, it } from "vitest";

import { logVerbosityAtLeast } from "../logVerbosity";

describe("logVerbosityAtLeast", () => {
  it("defaults to verbose when undefined", () => {
    expect(logVerbosityAtLeast(undefined, "verbose")).toBe(true);
    expect(logVerbosityAtLeast(undefined, "standard")).toBe(true);
    expect(logVerbosityAtLeast(undefined, "minimal")).toBe(true);
  });

  it("minimal only satisfies minimal", () => {
    expect(logVerbosityAtLeast("minimal", "minimal")).toBe(true);
    expect(logVerbosityAtLeast("minimal", "standard")).toBe(false);
    expect(logVerbosityAtLeast("minimal", "verbose")).toBe(false);
  });

  it("standard satisfies minimal and standard, not verbose", () => {
    expect(logVerbosityAtLeast("standard", "minimal")).toBe(true);
    expect(logVerbosityAtLeast("standard", "standard")).toBe(true);
    expect(logVerbosityAtLeast("standard", "verbose")).toBe(false);
  });

  it("verbose satisfies everything", () => {
    expect(logVerbosityAtLeast("verbose", "minimal")).toBe(true);
    expect(logVerbosityAtLeast("verbose", "standard")).toBe(true);
    expect(logVerbosityAtLeast("verbose", "verbose")).toBe(true);
  });
});
