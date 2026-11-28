import {
  LEGACY_SUSPENSION_KIND_MAP,
  type GateKind,
  GATE_KINDS,
} from "./constants";

/** Map legacy checkpoint suspensionKind → hub GateKind. */
export function mapLegacySuspensionKind(kind: string): GateKind | undefined {
  if (kind in LEGACY_SUSPENSION_KIND_MAP) {
    return LEGACY_SUSPENSION_KIND_MAP[
      kind as keyof typeof LEGACY_SUSPENSION_KIND_MAP
    ];
  }
  if ((GATE_KINDS as readonly string[]).includes(kind)) {
    return kind as GateKind;
  }
  return undefined;
}
