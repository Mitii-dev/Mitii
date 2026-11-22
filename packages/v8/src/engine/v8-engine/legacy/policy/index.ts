/**
 * Re-exports for loop-policy window bands (shipped standards by context window).
 * Edit permanent band values in `./loopPolicyBands.ts` (or Developer → Policy Admin → Save to ship code).
 * Policy Lab helpers remain for schema/promote tooling.
 */
export {
  LOOP_POLICY_WINDOW_BANDS,
  LOOP_POLICY_WINDOW_BAND_CEILINGS,
  LOOP_POLICY_WINDOW_BAND_TABLE,
  resolveLoopPolicyWindowBand,
  loopPolicyWindowBandDefinition,
  listLoopPolicyWindowBands,
} from "./loopPolicyBands";
export type {
  LoopPolicyWindowBand,
  LoopPolicyWindowBandDefinition,
} from "./loopPolicyBands";

export {
  POLICY_LAB_SCHEMA_VERSION,
  policyLabFileSchema,
  EMPTY_POLICY_LAB,
  parsePolicyLabFile,
  tryParsePolicyLabFile,
} from "./policyLab";
export type { PolicyLabFile } from "./policyLab";

export {
  resolvePolicyLabOverrides,
  mergeLabUnderHostOverrides,
} from "./resolvePolicyLabOverrides";
export type {
  ResolvePolicyLabOverridesInput,
  ResolvedPolicyLabOverrides,
} from "./resolvePolicyLabOverrides";

export {
  promotePolicyLabToShip,
  labLoopDeltas,
  labWindowDeltas,
} from "./promotePolicyLab";
export type {
  PromotePolicyLabInput,
  PromotePolicyLabResult,
} from "./promotePolicyLab";
