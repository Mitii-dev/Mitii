import { describe, expect, it } from "vitest";

import { shouldEmitHeartbeat } from "../../helpers/heartbeat/ShouldEmitHeartbeat";
import {
  revokeMcpAttach,
  stampMcpAttach,
} from "../../helpers/mcp/StampMcpAttach";
import { buildTaskHandoff } from "../../helpers/handoff/BuildTaskHandoff";
import { isApprovedPlanFresh } from "../../helpers/build/IsApprovedPlanFresh";

describe("P7 seams", () => {
  it("heartbeat respects interval", () => {
    expect(
      shouldEmitHeartbeat({
        nowMs: 1000,
        runActive: true,
      }),
    ).toBe(true);
    expect(
      shouldEmitHeartbeat({
        lastHeartbeatAtMs: 1000,
        nowMs: 10_000,
        intervalMs: 45_000,
        runActive: true,
      }),
    ).toBe(false);
    expect(
      shouldEmitHeartbeat({
        lastHeartbeatAtMs: 1000,
        nowMs: 50_000,
        intervalMs: 45_000,
        runActive: true,
      }),
    ).toBe(true);
  });

  it("mcp attach/revoke is set-based", () => {
    const attached = stampMcpAttach({
      allowedMcpServerIds: ["a"],
      attachServerId: "b",
    });
    expect(attached).toEqual(["a", "b"]);
    expect(
      revokeMcpAttach({ allowedMcpServerIds: attached, revokeServerId: "a" }),
    ).toEqual(["b"]);
  });

  it("handoff + build freshness", () => {
    expect(buildTaskHandoff({ toTaskId: "t2", reason: "done" }).toTaskId).toBe(
      "t2",
    );
    expect(
      isApprovedPlanFresh({
        approvedPlanFingerprint: "p1",
        storePlanFingerprint: "p1",
      }),
    ).toBe(true);
    expect(
      isApprovedPlanFresh({
        approvedPlanFingerprint: "p1",
        storePlanFingerprint: "p2",
      }),
    ).toBe(false);
  });
});
