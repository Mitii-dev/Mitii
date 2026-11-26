import { describe, expect, it } from "vitest";

import {
  DISCOVERY_SEARCH_EVIDENCE_NUDGE,
  DISCOVERY_SYMBOL_EVIDENCE_NUDGE,
  buildDiscoveryFailureWarning,
  buildDiscoveryQualityFloorNudge,
} from "./pinDiscoveryPassNudges";

describe("pinDiscoveryPassNudges", () => {
  it("builds quality-floor nudges by thoroughness", () => {
    expect(
      buildDiscoveryQualityFloorNudge({
        thoroughEvidence: false,
        preferSymbolEvidence: false,
      }),
    ).toContain("at least one concrete");
    expect(
      buildDiscoveryQualityFloorNudge({
        thoroughEvidence: true,
        preferSymbolEvidence: true,
      }),
    ).toContain("document_symbol");
    expect(
      buildDiscoveryQualityFloorNudge({
        thoroughEvidence: true,
        preferSymbolEvidence: false,
      }),
    ).toContain("two productive source files");
  });

  it("exposes symbol/search nudge copy", () => {
    expect(DISCOVERY_SYMBOL_EVIDENCE_NUDGE).toContain("document_symbol");
    expect(DISCOVERY_SEARCH_EVIDENCE_NUDGE).toContain("search_files");
  });

  it("builds failure warnings by quality floor", () => {
    expect(
      buildDiscoveryFailureWarning({
        qualityFloor: false,
        thoroughEvidence: false,
      }),
    ).toContain("open questions");
    expect(
      buildDiscoveryFailureWarning({
        qualityFloor: true,
        thoroughEvidence: true,
      }),
    ).toContain("Thorough plan discovery");
  });
});
