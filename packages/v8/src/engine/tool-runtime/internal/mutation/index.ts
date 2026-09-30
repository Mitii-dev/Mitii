export {
  assertNoDirtyOverlap,
  createFileCopyCheckpoint,
  restoreFileCopyCheckpoint,
  hashContent,
  listRelativeFilesUnder,
  mapMovedRelativePath,
  requireRename,
  requireRmdir,
} from "./checkpoint";
export {
  preflightStructuredPatch,
  validatePostEditSyntax,
} from "./applyStructuredPatch";
export { MutationTransactionRegistry } from "./MutationTransactionRegistry";
export type {
  MutationTransactionApplyResult,
  MutationPathResult,
} from "./MutationTransactionRegistry";
export {
  withPathMutationQueue,
  resetPathMutationQueuesForTests,
} from "./pathMutationQueue";
export { assertApprovalSatisfied } from "./assertApprovalSatisfied";
export type { ToolApprovalToken } from "./assertApprovalSatisfied";
export { MutationError } from "./types";
export type {
  AppliedPatchRecord,
  CheckpointFileSnapshot,
  MutationCheckpoint,
  StructuredPatch,
} from "./types";
export { fingerprintToolCall } from "./fingerprintToolCall";
