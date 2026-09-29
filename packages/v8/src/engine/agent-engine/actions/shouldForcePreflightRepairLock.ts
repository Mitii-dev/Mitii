/**
 * When preflight already captured typecheck/build errors, start the mutate
 * loop under mutation discipline (no broad rediscovery) so repair asks do not
 * burn the stall budget hunting unrelated files.
 */
export function shouldForcePreflightRepairLock(params: {
  route: string;
  maximumWorkspaceEffect: string;
  preflightErrorCount: number;
  changedFilesCount?: number;
}): boolean {
  if ((params.changedFilesCount ?? 0) > 0) {
    return false;
  }
  if (params.route !== "execute") {
    return false;
  }
  if (params.maximumWorkspaceEffect !== "write") {
    return false;
  }
  return params.preflightErrorCount > 0;
}
