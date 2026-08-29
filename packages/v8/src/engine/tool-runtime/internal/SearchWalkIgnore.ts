import { WS_CONSTANTS } from "../../../modules/repository-state";

/**
 * Directory names skipped while collecting files for search_files.
 * Keep aligned with WorkspaceIgnorePolicy so agent logs and build artifacts
 * never crowd out source matches.
 */
export const SEARCH_WALK_SKIP_DIRECTORY_NAMES = new Set<string>([
  ...WS_CONSTANTS.DEFAULT_IGNORED_DIRECTORY_NAMES,
]);

export function shouldSkipSearchWalkEntry(params: {
  name: string;
  relativePath: string;
  isDirectory: boolean;
}): boolean {
  if (params.isDirectory) {
    return SEARCH_WALK_SKIP_DIRECTORY_NAMES.has(params.name);
  }
  const relative = params.relativePath.replace(/\\/g, "/");
  if (relative === ".mitii" || relative.startsWith(".mitii/")) {
    return true;
  }
  const extension = extensionOf(params.name);
  return WS_CONSTANTS.DEFAULT_IGNORED_EXTENSIONS.has(extension);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return fileName.slice(dot).toLowerCase();
}
