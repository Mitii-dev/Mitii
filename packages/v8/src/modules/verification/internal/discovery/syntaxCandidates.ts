import type { LanguageId } from "../../../repository-state";

import { NODE_MODULE_LOAD_EVIDENCE } from "../../contracts";
import type { DiscoveredCheckCandidate } from "./types";
import { commandCandidate } from "./types";

/**
 * Cheap syntax-only checks for changed files. These never satisfy typecheck
 * evidence — they are a fast localized gate before heavier project scripts.
 */
export function syntaxCandidatesForChangedFiles(params: {
  projectId: string;
  languageId: LanguageId;
  projectRoot: string;
  changedFiles: readonly string[];
}): DiscoveredCheckCandidate[] {
  const root = normalizeRoot(params.projectRoot);
  const inProject = params.changedFiles.filter((file) =>
    fileBelongsToProject(file, root),
  );
  if (inProject.length === 0) {
    return [];
  }

  const candidates: DiscoveredCheckCandidate[] = [];

  const pythonFiles = inProject.filter((file) => /\.py$/i.test(file)).slice(0, 8);
  if (
    (params.languageId === "python" || params.languageId === "unknown") &&
    pythonFiles.length > 0
  ) {
    candidates.push(
      commandCandidate({
        projectId: params.projectId,
        kind: "syntax",
        label: `python -m py_compile (${params.projectId})`,
        evidenceSource: "changed-files:py_compile",
        languageId: "python",
        argv: ["python3", "-m", "py_compile", ...pythonFiles],
        mayBeUnavailable: true,
      }),
    );
  }

  const jsFiles = inProject
    .filter((file) => /\.(js|mjs|cjs)$/i.test(file))
    .slice(0, 8);
  if (
    (params.languageId === "javascript" ||
      params.languageId === "typescript" ||
      params.languageId === "unknown") &&
    jsFiles.length > 0
  ) {
    const languageId =
      params.languageId === "typescript" ? "typescript" : "javascript";
    // Module-load catches duplicate exports / instantiate errors that
    // `node --check` and tree-sitter parse miss. Prefer this over parse-only.
    candidates.push(
      commandCandidate({
        projectId: params.projectId,
        kind: "syntax",
        label: `node --import (module load, ${params.projectId})`,
        evidenceSource: NODE_MODULE_LOAD_EVIDENCE,
        languageId,
        argv: buildNodeModuleLoadArgv(jsFiles),
        mayBeUnavailable: true,
      }),
    );
    // node --check is JS-only; TypeScript stays on typecheck/diagnostics.
    candidates.push(
      commandCandidate({
        projectId: params.projectId,
        kind: "syntax",
        label: `node --check (${params.projectId})`,
        evidenceSource: "changed-files:node_check",
        languageId,
        argv: ["node", "--check", ...jsFiles],
        mayBeUnavailable: true,
      }),
    );
  }

  const shellFiles = inProject
    .filter((file) => /\.(sh|bash|zsh)$/i.test(file))
    .slice(0, 8);
  if (
    (params.languageId === "shell" || params.languageId === "unknown") &&
    shellFiles.length > 0
  ) {
    for (const file of shellFiles) {
      candidates.push(
        commandCandidate({
          projectId: params.projectId,
          kind: "syntax",
          label: `bash -n ${file}`,
          evidenceSource: "changed-files:bash_n",
          languageId: "shell",
          argv: ["bash", "-n", file],
          mayBeUnavailable: true,
        }),
      );
    }
  }

  return candidates;
}

/**
 * `node --import <file> … -e "void 0"` instantiates each module (ESM/CJS).
 * `-e` must be non-empty (tool argv schema rejects `""`). Process env should
 * include MITII_NO_LISTEN=1 for fixtures that call listen() at top level
 * (injected by CommandPolicy).
 */
export function buildNodeModuleLoadArgv(files: readonly string[]): string[] {
  const argv: string[] = ["node"];
  for (const file of files) {
    argv.push("--import", toNodeImportSpecifier(file));
  }
  argv.push("-e", "void 0");
  return argv;
}

/** Node treats bare `src/a.js` as a package name — force a relative path. */
export function toNodeImportSpecifier(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return normalized;
  }
  return `./${normalized}`;
}

function normalizeRoot(rootPath: string): string {
  return rootPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") || ".";
}

function fileBelongsToProject(filePath: string, projectRoot: string): boolean {
  const file = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (projectRoot === "." || projectRoot === "") {
    return true;
  }
  return file === projectRoot || file.startsWith(`${projectRoot}/`);
}
