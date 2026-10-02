import { describe, expect, it } from "vitest";

import { decideMutateEvidenceAction } from "./decideMutateEvidenceAction";

describe("decideMutateEvidenceAction", () => {
  const baseReadiness = {
    ready: false,
    writePaths: ["src/a.ts"],
    missingPaths: ["src/a.ts"],
    activeItemId: "step-1",
  };

  it("demands evidence gate while nudge budget remains", () => {
    const decision = decideMutateEvidenceAction({
      readiness: baseReadiness,
      seedTrusted: true,
      evidenceGateNudges: 0,
      maxEvidenceGateNudges: 3,
      recoveryAlreadyUsed: false,
      maxRecoveryPaths: 4,
    });
    expect(decision.kind).toBe("EVIDENCE_GATE");
    expect(decision.reason).toBe("missing_named_paths");
  });

  it("offers one local recovery after nudges are spent", () => {
    const decision = decideMutateEvidenceAction({
      readiness: baseReadiness,
      seedTrusted: true,
      evidenceGateNudges: 3,
      maxEvidenceGateNudges: 3,
      recoveryAlreadyUsed: false,
      maxRecoveryPaths: 4,
    });
    expect(decision.kind).toBe("RECOVERY_REQUIRED");
    expect(decision.reason).toBe("one_local_dependency");
    expect(decision.recoveryPaths).toEqual(["src/a.ts"]);
  });

  it("clarifies when recovery is exhausted (no unlimited discovery)", () => {
    const decision = decideMutateEvidenceAction({
      readiness: baseReadiness,
      seedTrusted: true,
      evidenceGateNudges: 3,
      maxEvidenceGateNudges: 3,
      recoveryAlreadyUsed: true,
      maxRecoveryPaths: 4,
    });
    expect(decision.kind).toBe("INSUFFICIENT_EVIDENCE");
    expect(decision.reason).toBe("recovery_exhausted");
  });

  it("authorizes patch when paths are loaded", () => {
    const decision = decideMutateEvidenceAction({
      readiness: {
        ready: true,
        writePaths: ["src/a.ts"],
        missingPaths: [],
        activeItemId: "step-1",
      },
      seedTrusted: true,
      evidenceGateNudges: 0,
      maxEvidenceGateNudges: 3,
      recoveryAlreadyUsed: false,
      maxRecoveryPaths: 4,
    });
    expect(decision).toEqual({
      kind: "PATCH_READY",
      reason: "paths_loaded",
      missingPaths: [],
    });
  });

  it("does not force patch when seed is weak", () => {
    const decision = decideMutateEvidenceAction({
      readiness: {
        ready: true,
        writePaths: [],
        missingPaths: [],
      },
      seedTrusted: false,
      evidenceGateNudges: 0,
      maxEvidenceGateNudges: 2,
      recoveryAlreadyUsed: false,
      maxRecoveryPaths: 4,
    });
    expect(decision.kind).toBe("INSUFFICIENT_EVIDENCE");
    expect(decision.reason).toBe("weak_seed");
  });
});
