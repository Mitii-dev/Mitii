/** Shim — owner is runtime/helpers/compaction. */
export {
  resolveCompactionPressure,
  resolveCompactionThresholds,
  DEFAULT_AUTO_RATIO,
  DEFAULT_HARD_RATIO,
  DEFAULT_WARN_RATIO,
} from "../../../runtime/helpers/compaction";
export type {
  ModelLoopCompactionPressure,
  ModelLoopCompactionThresholds,
} from "../../../runtime/helpers/compaction";
