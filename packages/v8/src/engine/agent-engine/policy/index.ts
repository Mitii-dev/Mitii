/**
 * Re-exports for loop-policy window bands (shipped standards by context window).
 * Edit permanent band values in `./loopPolicyBands.ts`.
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
