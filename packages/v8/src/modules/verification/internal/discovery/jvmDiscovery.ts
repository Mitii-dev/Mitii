import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

export async function discoverJvmChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const root = params.project.rootPath;
  const pom = joinRoot(root, "pom.xml");
  const gradle = joinRoot(root, "build.gradle");
  const gradleKts = joinRoot(root, "build.gradle.kts");
  const gradlew = joinRoot(root, "gradlew");
  const mvnw = joinRoot(root, "mvnw");

  const languageId = params.project.primaryLanguageId;
  const candidates = [];
  const warnings: string[] = [];

  if (await params.manifests.exists(pom)) {
    const mvn = (await params.manifests.exists(mvnw)) ? "./mvnw" : "mvn";
    candidates.push(
      commandCandidate({
        projectId: params.project.projectId,
        kind: "test",
        label: `${mvn} test (${params.project.projectId})`,
        evidenceSource: `manifest:${pom}`,
        languageId,
        argv: [mvn, "test", "-f", pom],
        mayBeUnavailable: true,
      }),
      commandCandidate({
        projectId: params.project.projectId,
        kind: "build",
        label: `${mvn} -DskipTests package (${params.project.projectId})`,
        evidenceSource: `manifest:${pom}`,
        languageId,
        argv: [mvn, "-DskipTests", "package", "-f", pom],
        mayBeUnavailable: true,
      }),
    );
  } else if (
    (await params.manifests.exists(gradle)) ||
    (await params.manifests.exists(gradleKts))
  ) {
    const evidence = (await params.manifests.exists(gradleKts))
      ? gradleKts
      : gradle;
    const gradleBin = (await params.manifests.exists(gradlew))
      ? "./gradlew"
      : "gradle";
    candidates.push(
      commandCandidate({
        projectId: params.project.projectId,
        kind: "test",
        label: `${gradleBin} test (${params.project.projectId})`,
        evidenceSource: `manifest:${evidence}`,
        languageId,
        argv:
          root === "." || root === ""
            ? [gradleBin, "test"]
            : [gradleBin, "-p", root, "test"],
        mayBeUnavailable: true,
      }),
      commandCandidate({
        projectId: params.project.projectId,
        kind: "build",
        label: `${gradleBin} build -x test (${params.project.projectId})`,
        evidenceSource: `manifest:${evidence}`,
        languageId,
        argv:
          root === "." || root === ""
            ? [gradleBin, "build", "-x", "test"]
            : [gradleBin, "-p", root, "build", "-x", "test"],
        mayBeUnavailable: true,
      }),
    );
  } else {
    warnings.push(
      `No pom.xml/build.gradle for project "${params.project.projectId}" — JVM checks unavailable.`,
    );
  }

  return { candidates, warnings };
}
