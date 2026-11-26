import { describe, expect, it } from "vitest";

import { StoreManager } from "../../helpers/store";
import {
  RunState,
  buildCheckpointFromRunState,
  hydrateRunStateFromCheckpoint,
  RUN_STATE_KEYS,
} from "../../helpers/run-state";
import { applyMcpMidRun } from "../../helpers/mcp/ApplyMcpMidRun";
import { applyMcpMidRunToRunState } from "../../helpers/mcp/ApplyMcpMidRunToRunState";

describe("S11 RunState storeroom", () => {
  it("RunState get/set known slices", () => {
    const store = StoreManager.create("rs-1");
    const rs = RunState.from(store);
    rs.set("taskList", { schemaVersion: 1, source: "plan", items: [] });
    rs.set("mcpServerIds", ["mcp.a"]);
    expect(rs.get("mcpServerIds")).toEqual(["mcp.a"]);
    expect(rs.knownPresent()).toEqual(
      expect.arrayContaining(["taskList", "mcpServerIds"]),
    );
    expect(RUN_STATE_KEYS).toContain("situationPack");
  });

  it("checkpoint round-trip hydrates slices", () => {
    const store = StoreManager.create("rs-2");
    const rs = RunState.from(store);
    rs.set("lastAssistantText", "hello");
    rs.set("decision", { route: "execute" });

    const checkpoint = buildCheckpointFromRunState({
      runState: rs,
      requestId: "req-1",
      suspensionKind: "clarification_required",
      reasonCodes: ["test"],
    });
    expect(checkpoint.payload.storeSnapshot).toBeDefined();
    expect(checkpoint.reasonCodes).toContain("run_state_checkpointed");

    const store2 = StoreManager.create("rs-2");
    const rs2 = RunState.from(store2);
    const result = hydrateRunStateFromCheckpoint(rs2, checkpoint);
    expect(result.hydrated).toBe(true);
    expect(rs2.get("lastAssistantText")).toBe("hello");
    expect(rs2.get<{ route: string }>("decision")?.route).toBe("execute");
  });

  it("hydrate without snapshot is honest no-op", () => {
    const store = StoreManager.create("rs-3");
    const rs = RunState.from(store);
    const result = hydrateRunStateFromCheckpoint(rs, {
      runId: "rs-3",
      requestId: "r",
      suspensionKind: "continue_required",
      payload: {},
      reasonCodes: [],
      suspendedAtMs: Date.now(),
    });
    expect(result.hydrated).toBe(false);
    expect(result.reasonCodes).toContain("run_state_hydrate_no_snapshot");
  });
});

describe("§16 MCP mid-run", () => {
  it("attach is additive; revoke shrinks immediately", () => {
    const attached = applyMcpMidRun({
      runId: "m1",
      action: "attach",
      serverId: "mcp.new",
      currentMcpServerIds: ["mcp.old"],
    });
    expect(attached.mcpServerIds).toEqual(["mcp.old", "mcp.new"]);
    expect(attached.refreshEnrich).toBe(true);

    const revoked = applyMcpMidRun({
      runId: "m1",
      action: "revoke",
      serverId: "mcp.old",
      currentMcpServerIds: attached.mcpServerIds,
    });
    expect(revoked.mcpServerIds).toEqual(["mcp.new"]);
    expect(revoked.reasonCodes).toContain("mcp_mid_run_revoked");
  });

  it("required revoke escalates auth_or_dependency when extended", () => {
    const result = applyMcpMidRun({
      runId: "m2",
      action: "revoke",
      serverId: "mcp.needed",
      currentMcpServerIds: ["mcp.needed"],
      requiredForActiveTask: true,
      enableExtendedGates: true,
    });
    expect(result.gateVerdict?.action).toBe("suspend");
    expect(result.gateVerdict?.kind).toBe("auth_or_dependency_required");
    expect(result.reasonCodes).toContain("mcp_mid_run_auth_gate");
  });

  it("applyMcpMidRunToRunState persists ids", () => {
    const store = StoreManager.create("m3");
    const rs = RunState.from(store);
    rs.set("mcpServerIds", ["a"]);
    const result = applyMcpMidRunToRunState(rs, {
      action: "attach",
      serverId: "b",
    });
    expect(result.mcpServerIds).toEqual(["a", "b"]);
    expect(rs.get("mcpServerIds")).toEqual(["a", "b"]);
  });
});
