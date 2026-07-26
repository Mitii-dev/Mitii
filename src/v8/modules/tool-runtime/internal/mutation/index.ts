export { fingerprintToolCall } from "./fingerprintToolCall";
export {
  assertNoDirtyOverlap,
  createFileCopyCheckpoint,
  restoreFileCopyCheckpoint,
  hashContent,
} from "./checkpoint";
export {
  preflightStructuredPatch,
  validatePostEditSyntax,
} from "./applyStructuredPatch";
export { MutationTransactionRegistry } from "./MutationTransactionRegistry";
export type { MutationTransactionApplyResult } from "./MutationTransactionRegistry";
export { assertApprovalSatisfied } from "./assertApprovalSatisfied";
export type { ToolApprovalToken } from "./assertApprovalSatisfied";
export { MutationError } from "./types";
export type {
  AppliedPatchRecord,
  CheckpointFileSnapshot,
  MutationCheckpoint,
  StructuredPatch,
} from "./types";
