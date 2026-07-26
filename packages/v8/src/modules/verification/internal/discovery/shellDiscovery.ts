import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

/**
 * Shell verification only when project evidence declares shellcheck/shfmt.
 * Never invent a universal shell test command.
 */
export async function discoverShellChecks(params: {
  project: ProjectDescriptor;
  changedFiles: readonly string[];
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const root = params.project.rootPath;
  const packageJson = joinRoot(root, "package.json");
  const makefile = joinRoot(root, "Makefile");
  const candidates = [];
  const warnings: string[] = [];

  const pkgRaw = await params.manifests.readText(packageJson);
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      for (const name of ["shellcheck", "lint:shell", "shfmt"] as const) {
        if (!pkg.scripts?.[name]) continue;
        candidates.push(
          commandCandidate({
            projectId: params.project.projectId,
            kind: name === "shfmt" ? "format" : "lint",
            label: `npm run ${name} (${params.project.projectId})`,
            evidenceSource: `manifest:${packageJson}#scripts.${name}`,
            languageId: "shell",
            argv: ["npm", "run", name],
            mayBeUnavailable: true,
          }),
        );
      }
    } catch {
      warnings.push(`Invalid package.json at "${packageJson}".`);
    }
  }

  if (
    candidates.length === 0 &&
    (await params.manifests.exists(makefile))
  ) {
    const text = (await params.manifests.readText(makefile)) ?? "";
    if (/\bshellcheck\b/i.test(text)) {
      candidates.push(
        commandCandidate({
          projectId: params.project.projectId,
          kind: "lint",
          label: `make shellcheck (${params.project.projectId})`,
          evidenceSource: `manifest:${makefile}#shellcheck`,
          languageId: "shell",
          argv:
            root === "." || root === ""
              ? ["make", "shellcheck"]
              : ["make", "-C", root, "shellcheck"],
          mayBeUnavailable: true,
        }),
      );
    }
  }

  if (candidates.length === 0) {
    const shellFiles = params.changedFiles.filter((file) =>
      /\.(sh|bash|zsh)$/i.test(file),
    );
    warnings.push(
      shellFiles.length > 0
        ? `Shell files changed in "${params.project.projectId}" but no shellcheck/shfmt evidence — checks unavailable (not invented).`
        : `No shell verification tooling discovered for "${params.project.projectId}".`,
    );
  }

  return { candidates, warnings };
}
