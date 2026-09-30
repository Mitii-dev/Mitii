/**
 * Public facade for model-facing output bounding + optional spill.
 */
export {
  boundToolOutput,
  headTailPreview,
  isMitiiBoundedToolOutput,
  BOUNDED_OUTPUT_MARKER,
} from "./internal/output/boundToolOutput";
export type {
  BoundToolOutputParams,
  BoundToolOutputResult,
  MitiiBoundedToolOutput,
} from "./internal/output/boundToolOutput";
