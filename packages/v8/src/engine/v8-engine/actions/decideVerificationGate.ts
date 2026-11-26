/**
 * Shim — owner is runtime/helpers/verify (DecideVerificationGate*).
 */
export {
  decideVerificationGate,
  resolveFailedVerificationTerminalStatus,
} from "../../../runtime/helpers/verify";
export type { VerificationGateDecision } from "../../../runtime/helpers/verify";
export { isUserGoalComplete } from "../../../runtime/helpers/verify";
export {
  askScopedDiagnosticsClean,
  packageCompileEvidencePassed,
  failuresAreIgnorableWhenPackagePassed,
  isPhantomConfigDiagnostic,
  isPackageScopedCheck,
  isWorkspaceRootCheck,
} from "../../../runtime/helpers/verify";
