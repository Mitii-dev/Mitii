import { describe, expect, it } from "vitest";

import { shouldForcePreflightRepairLock } from "../shouldForcePreflightRepairLock";

describe("shouldForcePreflightRepairLock", () => {
  it("locks execute+write when preflight already captured errors", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 200,
      }),
    ).toBe(true);
  });

  it("does not lock when there are no preflight errors", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 0,
      }),
    ).toBe(false);
  });

  it("does not lock read-only or non-execute routes", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "diagnose",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 12,
      }),
    ).toBe(false);
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "read",
        preflightErrorCount: 12,
      }),
    ).toBe(false);
  });

  it("does not lock after files already changed", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 12,
        changedFilesCount: 1,
      }),
    ).toBe(false);
  });
});
