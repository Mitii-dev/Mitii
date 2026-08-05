import { describe, expect, it } from "vitest";

import { looksLikeWorkspaceBugReport } from "../actions/LooksLikeWorkspaceBugReport";

describe("looksLikeWorkspaceBugReport", () => {
  it("matches exact not-working workspace reports", () => {
    expect(
      looksLikeWorkspaceBugReport(
        "Preview is not working on http://localhost:3000/docs",
      ),
    ).toBe(true);
  });

  it("matches single-edit typos of not before working", () => {
    expect(
      looksLikeWorkspaceBugReport(
        [
          "working",
          "http://localhost:3000/core-docs/a",
          "nbot working",
          "http://localhost:3000/ffb-mui-docs/b",
          "preview",
        ].join("\n"),
      ),
    ).toBe(true);
  });

  it("rejects failure language without a workspace anchor", () => {
    expect(looksLikeWorkspaceBugReport("nbot working today")).toBe(false);
  });

  it("rejects non-not near-misses before working", () => {
    expect(
      looksLikeWorkspaceBugReport(
        "got working preview on http://localhost:3000/docs",
      ),
    ).toBe(false);
  });

  it("matches Python NameError and Rust-style path anchors", () => {
    expect(
      looksLikeWorkspaceBugReport(
        "NameError: name 'load_config' is not defined in @crates/core",
      ),
    ).toBe(true);
  });

  it("matches layout-neutral file path anchors with failure language", () => {
    expect(
      looksLikeWorkspaceBugReport(
        "build failed in backend/api/handlers/main.go",
      ),
    ).toBe(true);
  });
});
