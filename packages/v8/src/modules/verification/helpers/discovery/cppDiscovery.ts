import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

export async function discoverCppChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const root = params.project.rootPath;
  const cmake = joinRoot(root, "CMakeLists.txt");
  const makefile = joinRoot(root, "Makefile");
  const languageId = params.project.primaryLanguageId;

  if (await params.manifests.exists(cmake)) {
    const buildDir = root === "." || root === "" ? "build" : `${root}/build`;
    return {
      candidates: [
        commandCandidate({
          projectId: params.project.projectId,
          kind: "build",
          label: `cmake --build (${params.project.projectId})`,
          evidenceSource: `manifest:${cmake}`,
          languageId,
          argv: ["cmake", "--build", buildDir],
          mayBeUnavailable: true,
        }),
        commandCandidate({
          projectId: params.project.projectId,
          kind: "test",
          label: `ctest (${params.project.projectId})`,
          evidenceSource: `manifest:${cmake}`,
          languageId,
          argv: ["ctest", "--test-dir", buildDir, "--output-on-failure"],
          mayBeUnavailable: true,
        }),
      ],
      warnings: [],
    };
  }

  if (await params.manifests.exists(makefile)) {
    return {
      candidates: [
        commandCandidate({
          projectId: params.project.projectId,
          kind: "build",
          label: `make (${params.project.projectId})`,
          evidenceSource: `manifest:${makefile}`,
          languageId,
          argv:
            root === "." || root === ""
              ? ["make"]
              : ["make", "-C", root],
          mayBeUnavailable: true,
        }),
        commandCandidate({
          projectId: params.project.projectId,
          kind: "test",
          label: `make test (${params.project.projectId})`,
          evidenceSource: `manifest:${makefile}`,
          languageId,
          argv:
            root === "." || root === ""
              ? ["make", "test"]
              : ["make", "-C", root, "test"],
          mayBeUnavailable: true,
        }),
      ],
      warnings: [],
    };
  }

  return {
    candidates: [],
    warnings: [
      `No CMakeLists.txt/Makefile for "${params.project.projectId}" — C/C++ checks unavailable.`,
    ],
  };
}
