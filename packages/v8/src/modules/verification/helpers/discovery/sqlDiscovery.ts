import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

/**
 * SQL has no universal verifier. Only emit checks when package/make evidence
 * declares an explicit SQL lint or test script.
 */
export async function discoverSqlChecks(params: {
  project: ProjectDescriptor;
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
      for (const name of ["sqlfluff", "lint:sql", "sql:test"] as const) {
        if (!pkg.scripts?.[name]) continue;
        candidates.push(
          commandCandidate({
            projectId: params.project.projectId,
            kind: name.includes("test") ? "test" : "lint",
            label: `npm run ${name} (${params.project.projectId})`,
            evidenceSource: `manifest:${packageJson}#scripts.${name}`,
            languageId: "sql",
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
    if (/\bsqlfluff\b/i.test(text)) {
      candidates.push(
        commandCandidate({
          projectId: params.project.projectId,
          kind: "lint",
          label: `make sqlfluff (${params.project.projectId})`,
          evidenceSource: `manifest:${makefile}#sqlfluff`,
          languageId: "sql",
          argv:
            root === "." || root === ""
              ? ["make", "sqlfluff"]
              : ["make", "-C", root, "sqlfluff"],
          mayBeUnavailable: true,
        }),
      );
    }
  }

  if (candidates.length === 0) {
    warnings.push(
      `No trusted SQL verification tooling discovered for "${params.project.projectId}" — unavailable (not invented).`,
    );
  }

  return { candidates, warnings };
}
