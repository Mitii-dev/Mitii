import { describe, expect, it } from "vitest";

import {
  buildEvidenceClarifyMessage,
  buildEvidenceRecoveryMessage,
  decideEvidenceRecovery,
  isIdentifiableLocalEvidence,
} from "./evidenceRecovery";

describe("evidenceRecovery valve", () => {
  it("treats concrete files as identifiable local evidence", () => {
    expect(
      isIdentifiableLocalEvidence([
        "apps/desktop/src/renderer/IndexStatusChip.tsx",
      ]),
    ).toBe(true);
    expect(isIdentifiableLocalEvidence(["apps/desktop"])).toBe(false);
    expect(isIdentifiableLocalEvidence([])).toBe(false);
  });

  it("offers one capped recovery for local misses", () => {
    const decision = decideEvidenceRecovery({
      missingPaths: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"],
      recoveryAlreadyUsed: false,
      maxRecoveryPaths: 4,
    });
    expect(decision.kind).toBe("recovery");
    if (decision.kind === "recovery") {
      expect(decision.paths).toHaveLength(4);
    }
    expect(buildEvidenceRecoveryMessage({ paths: ["src/a.ts"], recoveryTurns: 2 })).toContain(
      "Evidence recovery",
    );
  });

  it("clarifies when recovery already used or miss is not local", () => {
    expect(
      decideEvidenceRecovery({
        missingPaths: ["src/a.ts"],
        recoveryAlreadyUsed: true,
        maxRecoveryPaths: 4,
      }).kind,
    ).toBe("clarify");
    expect(
      decideEvidenceRecovery({
        missingPaths: ["apps/desktop"],
        recoveryAlreadyUsed: false,
        maxRecoveryPaths: 4,
      }).kind,
    ).toBe("clarify");
    expect(buildEvidenceClarifyMessage("name the file")).toContain(
      "Do not keep rediscovering",
    );
  });
});
