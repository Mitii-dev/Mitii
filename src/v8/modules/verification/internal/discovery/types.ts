import type { LanguageId } from "../../../repository-state";

import type { VerificationCheckKind } from "../../contracts";

export interface DiscoveredCheckCandidate {
  checkId: string;
  kind: VerificationCheckKind;
  projectId?: string;
  label: string;
  evidenceSource: string;
  languageId: LanguageId;
  /** Tool Runtime tool name used for execution. */
  toolName: "run_readonly_command" | "read_diagnostics" | "read_git_status";
  toolArguments: Record<string, unknown>;
  argv?: string[];
  /** When true, discovery found evidence but the tool/binary may be absent. */
  mayBeUnavailable?: boolean;
}

export interface ProjectDiscoveryResult {
  candidates: DiscoveredCheckCandidate[];
  warnings: string[];
}

export function joinRoot(rootPath: string, fileName: string): string {
  const root = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  if (root === "." || root === "") {
    return fileName;
  }
  return `${root}/${fileName}`;
}

export function packageManagerArgv(
  packageManager: "npm" | "pnpm" | "yarn" | "bun",
  script: string,
  projectRoot: string,
): string[] {
  const root = projectRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const atRoot = root === "." || root === "";

  if (packageManager === "pnpm") {
    if (atRoot) {
      return script === "test" ? ["pnpm", "test"] : ["pnpm", "run", script];
    }
    return ["pnpm", "--dir", root, "run", script];
  }

  if (packageManager === "yarn") {
    if (atRoot) {
      return script === "test" ? ["yarn", "test"] : ["yarn", "run", script];
    }
    return ["yarn", "--cwd", root, "run", script];
  }

  if (packageManager === "bun") {
    if (atRoot) {
      return script === "test" ? ["bun", "test"] : ["bun", "run", script];
    }
    return ["bun", "run", "--cwd", root, script];
  }

  if (atRoot) {
    return script === "test" ? ["npm", "test"] : ["npm", "run", script];
  }
  return ["npm", "run", script, "--prefix", root];
}

export function commandCandidate(params: {
  projectId: string;
  kind: VerificationCheckKind;
  label: string;
  evidenceSource: string;
  languageId: LanguageId;
  argv: string[];
  mayBeUnavailable?: boolean;
}): DiscoveredCheckCandidate {
  return {
    checkId: `${params.projectId}:${params.kind}:${params.argv.join("_")}`,
    kind: params.kind,
    projectId: params.projectId,
    label: params.label,
    evidenceSource: params.evidenceSource,
    languageId: params.languageId,
    toolName: "run_readonly_command",
    toolArguments: { argv: params.argv },
    argv: params.argv,
    mayBeUnavailable: params.mayBeUnavailable,
  };
}
