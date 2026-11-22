/**
 * @deprecated Prefer modules/user-path-priority. Kept as a thin re-export so
 * older action imports stay in sync with deferred-preflight semantics.
 */
export {
  citedRepoPathsFromPrompt,
  preflightDiagnosticsForUserRequest,
  preflightErrorsMatchUserRequest,
  shouldForcePreflightRepairLock,
  userRequestInvitesPreflightRepair,
} from "../modules/user-path-priority";
