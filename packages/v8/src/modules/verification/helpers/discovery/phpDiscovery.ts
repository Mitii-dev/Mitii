import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

interface ComposerJson {
  scripts?: Record<string, string | string[]>;
}

export async function discoverPhpChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const composerPath = joinRoot(params.project.rootPath, "composer.json");
  const raw = await params.manifests.readText(composerPath);
  if (!raw) {
    return {
      candidates: [],
      warnings: [
        `No composer.json for "${params.project.projectId}" — PHP checks unavailable.`,
      ],
    };
  }

  let composer: ComposerJson;
  try {
    composer = JSON.parse(raw) as ComposerJson;
  } catch {
    return {
      candidates: [],
      warnings: [`Invalid composer.json at "${composerPath}".`],
    };
  }

  const scripts = composer.scripts ?? {};
  const candidates = [];

  for (const name of ["test", "phpunit", "lint", "phpstan", "psalm"] as const) {
    if (!(name in scripts)) continue;
    const kind =
      name === "lint" || name === "phpstan" || name === "psalm"
        ? ("lint" as const)
        : ("test" as const);
    candidates.push(
      commandCandidate({
        projectId: params.project.projectId,
        kind,
        label: `composer ${name} (${params.project.projectId})`,
        evidenceSource: `manifest:${composerPath}#scripts.${name}`,
        languageId: "php",
        argv: ["composer", name],
        mayBeUnavailable: true,
      }),
    );
  }

  if (candidates.length === 0) {
    return {
      candidates: [],
      warnings: [
        `composer.json for "${params.project.projectId}" has no test/lint scripts.`,
      ],
    };
  }

  return { candidates, warnings: [] };
}
