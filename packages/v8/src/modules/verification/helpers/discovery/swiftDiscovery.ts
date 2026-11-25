import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

export async function discoverSwiftChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const pkg = joinRoot(params.project.rootPath, "Package.swift");
  if (!(await params.manifests.exists(pkg))) {
    return {
      candidates: [],
      warnings: [
        `No Package.swift for "${params.project.projectId}" — Swift checks unavailable.`,
      ],
    };
  }

  const root = params.project.rootPath;
  return {
    candidates: [
      commandCandidate({
        projectId: params.project.projectId,
        kind: "test",
        label: `swift test (${params.project.projectId})`,
        evidenceSource: `manifest:${pkg}`,
        languageId: "swift",
        argv:
          root === "." || root === ""
            ? ["swift", "test"]
            : ["swift", "test", "--package-path", root],
        mayBeUnavailable: true,
      }),
      commandCandidate({
        projectId: params.project.projectId,
        kind: "build",
        label: `swift build (${params.project.projectId})`,
        evidenceSource: `manifest:${pkg}`,
        languageId: "swift",
        argv:
          root === "." || root === ""
            ? ["swift", "build"]
            : ["swift", "build", "--package-path", root],
        mayBeUnavailable: true,
      }),
    ],
    warnings: [],
  };
}
