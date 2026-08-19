import type { BoundedWalkIgnoreContext } from "../../../shared/bounded-walker";
import { WorkspaceIgnorePolicy } from "./WorkspaceIgnorePolicy";

const securityPolicy = new WorkspaceIgnorePolicy();

/**
 * True when a path looks like credentials, keys, or env files and must not
 * be indexed or sent to a model.
 */
export function isSecurityConcern(filePathOrUri: string): boolean {
  const relativePath = toComparableRelativePath(filePathOrUri);
  if (!relativePath) {
    return false;
  }

  const context: BoundedWalkIgnoreContext = {
    root: "",
    path: relativePath,
    relativePath,
    depth: relativePath.split("/").filter(Boolean).length,
    kind: "file",
  };

  const decision = securityPolicy.evaluateSync(context);
  return decision.reason === "security";
}

export function toComparableRelativePath(filePathOrUri: string): string {
  if (!filePathOrUri) {
    return "";
  }

  let filepath = filePathOrUri.trim();
  if (filepath.startsWith("file:")) {
    try {
      filepath = decodeURIComponent(new URL(filepath).pathname);
    } catch {
      filepath = filepath.replace(/^file:\/\//, "");
    }
  }

  filepath = filepath.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(filepath)) {
    filepath = filepath.slice(2);
  }

  const segments = filepath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }

  return segments.join("/");
}
