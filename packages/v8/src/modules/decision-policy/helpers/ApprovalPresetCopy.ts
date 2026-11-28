/**
 * VS Code interactive approval presets (Safe / Guided / Pilot).
 * Distinct from CLI/automation `MitiiAutonomyPreset` (readonly/propose/apply).
 */

export const VSCODE_APPROVAL_PRESETS = ["safe", "guided", "pilot"] as const;
export type VsCodeApprovalPreset = (typeof VSCODE_APPROVAL_PRESETS)[number];

export interface ApprovalPresetCopy {
  id: VsCodeApprovalPreset;
  label: string;
  short: string;
  detail: string;
  mapsTo: {
    approvalMode: "every_mutation" | "when_required" | "never";
    planApproval: "policy" | "never";
  };
  /** What Ask/Plan seals still enforce regardless of this preset. */
  sealedNote: string;
}

export const APPROVAL_PRESET_COPY: readonly ApprovalPresetCopy[] = [
  {
    id: "safe",
    label: "Safe",
    short: "Ask before every write and risky command.",
    detail:
      "Best for unfamiliar repos. Mitii pauses on mutations so you can review each change.",
    mapsTo: { approvalMode: "every_mutation", planApproval: "policy" },
    sealedNote:
      "Ask mode still cannot edit files. Plan mode still cannot run shell or mutate.",
  },
  {
    id: "guided",
    label: "Guided",
    short: "Auto-approve routine tools; still gate consequential writes.",
    detail:
      "Default balance for daily coding. Policy decides when approval is required.",
    mapsTo: { approvalMode: "when_required", planApproval: "policy" },
    sealedNote:
      "Ask/Plan seals still apply. User safety rules (if enabled) can only tighten further.",
  },
  {
    id: "pilot",
    label: "Pilot",
    short: "Unattended agent — still blocked by mode seals and path rules.",
    detail:
      "For trusted local runs and CI-style work. Does not bypass Ask/Plan seals or OS sandbox.",
    mapsTo: { approvalMode: "never", planApproval: "never" },
    sealedNote:
      "Pilot never unlocks Ask writes or Plan shell. Optional .mitii/safety.json can still deny tools.",
  },
] as const;

export function getApprovalPresetCopy(
  preset: string | undefined,
): ApprovalPresetCopy {
  const normalized =
    preset === "builder" ? "guided" : (preset as VsCodeApprovalPreset);
  return (
    APPROVAL_PRESET_COPY.find((entry) => entry.id === normalized) ??
    APPROVAL_PRESET_COPY[1]!
  );
}

export function formatApprovalPresetHelp(): string {
  return APPROVAL_PRESET_COPY.map(
    (entry) =>
      `${entry.label} (${entry.id}): ${entry.short}\n  ${entry.detail}\n  Seals: ${entry.sealedNote}`,
  ).join("\n\n");
}
