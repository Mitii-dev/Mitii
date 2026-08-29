import { describe, expect, it } from "vitest";

import { describeCaughtError } from "../describeCaughtError";

describe("describeCaughtError", () => {
  it("includes the Node error code when present", () => {
    const error = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    expect(describeCaughtError(error)).toBe(
      "ENOENT: no such file or directory",
    );
  });

  it("appends the code when the message does not already mention it", () => {
    const error = new Error("permission denied") as NodeJS.ErrnoException;
    error.code = "EACCES";
    expect(describeCaughtError(error)).toBe("permission denied (EACCES)");
  });

  it("falls back to the error name when message is empty", () => {
    const error = new Error();
    error.name = "AbortError";
    expect(describeCaughtError(error)).toBe("AbortError");
  });

  it("passes through plain string throws", () => {
    expect(describeCaughtError("boom")).toBe("boom");
  });

  it("stringifies non-error, non-string values", () => {
    expect(describeCaughtError({ reason: "x" })).toBe('{"reason":"x"}');
  });
});
