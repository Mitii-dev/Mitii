import { describe, expect, it } from "vitest";

import { AGENT_ENGINE_SCHEMA_VERSION } from "../legacy/constants";
import { parseAgentRunResultResilient } from "./parseAgentRunResult";

const base = () => ({
  schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
  runId: "run-1",
  requestId: "req-1",
  status: "completed",
  answer: "done",
  reasonCodes: ["run_started", "verification_passed"],
  warnings: [] as string[],
  usage: { modelCalls: 1, toolCalls: 1, loopIterations: 1 },
  durationMs: 5,
});

const badEvidence = () => ({
  issues: [],
  ledger: [],
  verification: {
    status: "verified_success",
    checks: [
      {
        checkId: "c".repeat(400),
        kind: "test",
        outcome: "passed",
        summary: "s".repeat(800),
      },
    ],
  },
});

describe("parseAgentRunResultResilient", () => {
  it("returns valid candidates untouched", () => {
    const result = parseAgentRunResultResilient(base());
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).not.toContain("result_contract_degraded");
  });

  it("keeps a passing run when evidence violates the schema (regression)", () => {
    const result = parseAgentRunResultResilient({
      ...base(),
      evidence: badEvidence(),
    });
    expect(result.status).toBe("completed");
    expect(result.answer).toBe("done");
    expect(result.reasonCodes).toContain("verification_passed");
    expect(result.reasonCodes).toContain("result_contract_degraded");
    expect(result.warnings.join(" ")).toContain("evidence(clamped)");
    expect(result.evidence?.verification?.checks[0]?.checkId.length).toBeLessThanOrEqual(120);
  });

  it("drops an unrecoverable optional section instead of failing the run", () => {
    const result = parseAgentRunResultResilient({
      ...base(),
      verificationRecord: { not: "a record" },
    });
    expect(result.status).toBe("completed");
    expect(result.verificationRecord).toBeUndefined();
    expect(result.reasonCodes).toContain("result_contract_degraded");
    expect(result.warnings.join(" ")).toContain("verificationRecord(dropped)");
  });

  it("still throws when a core field is invalid", () => {
    expect(() =>
      parseAgentRunResultResilient({ ...base(), durationMs: -1 }),
    ).toThrow();
  });
});
