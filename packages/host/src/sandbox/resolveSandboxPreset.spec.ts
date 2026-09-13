import { describe, expect, it } from "vitest";

import {
  resolveSandboxPreset,
  resolveSandboxSettingsFromPreset,
} from "./resolveSandboxPreset.js";

describe("resolveSandboxPreset", () => {
  it("maps safe and guided to enabled+deny", () => {
    expect(resolveSandboxPreset("safe")).toEqual({
      enabled: true,
      network: "deny",
    });
    expect(resolveSandboxPreset("guided")).toEqual({
      enabled: true,
      network: "deny",
    });
    expect(resolveSandboxPreset("builder")).toEqual({
      enabled: true,
      network: "deny",
    });
  });

  it("maps pilot to enabled+allow", () => {
    expect(resolveSandboxPreset("pilot")).toEqual({
      enabled: true,
      network: "allow",
    });
  });

  it("defaults unknown modes to guided preset", () => {
    expect(resolveSandboxPreset(undefined)).toEqual({
      enabled: true,
      network: "deny",
    });
    expect(resolveSandboxPreset("other")).toEqual({
      enabled: true,
      network: "deny",
    });
  });
});

describe("resolveSandboxSettingsFromPreset", () => {
  it("applies preset only when enabled/network are unset", () => {
    expect(
      resolveSandboxSettingsFromPreset({ approvalMode: "pilot" }),
    ).toEqual({ enabled: true, network: "allow" });

    expect(
      resolveSandboxSettingsFromPreset({
        approvalMode: "pilot",
        enabled: false,
      }),
    ).toEqual({ enabled: false, network: "allow" });

    expect(
      resolveSandboxSettingsFromPreset({
        approvalMode: "safe",
        enabled: true,
        network: "allow",
      }),
    ).toEqual({ enabled: true, network: "allow" });
  });

  it("honors explicit false over guided preset", () => {
    expect(
      resolveSandboxSettingsFromPreset({
        approvalMode: "guided",
        enabled: false,
        network: "deny",
      }),
    ).toEqual({ enabled: false, network: "deny" });
  });
});
