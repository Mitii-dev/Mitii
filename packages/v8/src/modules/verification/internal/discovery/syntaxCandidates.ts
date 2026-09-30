import type { LanguageId } from "../../../repository-state";

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
    // node --check is JS-only; TypeScript stays on typecheck/diagnostics.
    candidates.push(
      commandCandidate({
        projectId: params.projectId,
        kind: "syntax",
        label: `node --check (${params.projectId})`,
        evidenceSource: "changed-files:node_check",
        languageId:
          params.languageId === "typescript" ? "typescript" : "javascript",
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
