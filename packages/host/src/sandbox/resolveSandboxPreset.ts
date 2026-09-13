/**
 * Map approval-mode presets to sandbox defaults when the host has not
 * explicitly set `safety.sandbox.enabled` / `network`.
 *
 * safe / guided (and legacy builder) → enabled + network deny
 * pilot → enabled + network allow
 */

import type { SandboxNetworkMode } from "./createSandboxedProcessPort.js";

export type SandboxApprovalPreset = "safe" | "guided" | "builder" | "pilot";

export interface SandboxPresetDefaults {
  enabled: boolean;
  network: SandboxNetworkMode;
}

export function resolveSandboxPreset(
  approvalMode: string | undefined,
): SandboxPresetDefaults {
  const mode =
    approvalMode === "builder"
      ? "guided"
      : approvalMode === "safe" ||
          approvalMode === "guided" ||
          approvalMode === "pilot"
        ? approvalMode
        : "guided";

  if (mode === "pilot") {
    return { enabled: true, network: "allow" };
  }
  return { enabled: true, network: "deny" };
}

/**
 * Resolve effective sandbox enabled/network:
 * - Use explicit host setting when defined (including `false`)
 * - Otherwise fall back to approval-mode preset defaults
 */
export function resolveSandboxSettingsFromPreset(params: {
  approvalMode?: string;
  enabled?: boolean;
  network?: string;
}): { enabled: boolean; network: SandboxNetworkMode } {
  const preset = resolveSandboxPreset(params.approvalMode);
  return {
    enabled:
      params.enabled !== undefined ? params.enabled === true : preset.enabled,
    network:
      params.network !== undefined
        ? params.network === "allow"
          ? "allow"
          : "deny"
        : preset.network,
  };
}
