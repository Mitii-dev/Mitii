import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

export async function discoverGoChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const goMod = joinRoot(params.project.rootPath, "go.mod");
  if (!(await params.manifests.exists(goMod))) {
    return {
      candidates: [],
      warnings: [
        `No go.mod for project "${params.project.projectId}" — Go checks unavailable.`,
      ],
    };
  }

  const root = params.project.rootPath;
  const packagePath = root === "." || root === "" ? "./..." : `./${root}/...`;

  return {
    candidates: [
      commandCandidate({
        projectId: params.project.projectId,
        kind: "test",
        label: `go test (${params.project.projectId})`,
        evidenceSource: `manifest:${goMod}`,
        languageId: "go",
        argv: ["go", "test", packagePath],
        mayBeUnavailable: true,
      }),
      commandCandidate({
        projectId: params.project.projectId,
        kind: "build",
        label: `go build (${params.project.projectId})`,
        evidenceSource: `manifest:${goMod}`,
        languageId: "go",
        argv: ["go", "build", packagePath],
        mayBeUnavailable: true,
      }),
    ],
    warnings: [],
  };
}
