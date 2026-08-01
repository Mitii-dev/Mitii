import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

export async function discoverRustChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const cargo = joinRoot(params.project.rootPath, "Cargo.toml");
  if (!(await params.manifests.exists(cargo))) {
    return {
      candidates: [],
      warnings: [
        `No Cargo.toml for project "${params.project.projectId}" — Rust checks unavailable.`,
      ],
    };
  }

  const root = params.project.rootPath;
  const manifestFlag =
    root === "." || root === ""
      ? ([] as string[])
      : ["--manifest-path", `${root}/Cargo.toml`];

  return {
    candidates: [
      commandCandidate({
        projectId: params.project.projectId,
        kind: "typecheck",
        label: `cargo check (${params.project.projectId})`,
        evidenceSource: `manifest:${cargo}`,
        languageId: "rust",
        argv: ["cargo", "check", ...manifestFlag],
        mayBeUnavailable: true,
      }),
      commandCandidate({
        projectId: params.project.projectId,
        kind: "test",
        label: `cargo test (${params.project.projectId})`,
        evidenceSource: `manifest:${cargo}`,
        languageId: "rust",
        argv: ["cargo", "test", ...manifestFlag],
        mayBeUnavailable: true,
      }),
      commandCandidate({
        projectId: params.project.projectId,
        kind: "lint",
        label: `cargo clippy (${params.project.projectId})`,
        evidenceSource: `manifest:${cargo}`,
        languageId: "rust",
        argv: ["cargo", "clippy", ...manifestFlag, "--", "-D", "warnings"],
        mayBeUnavailable: true,
      }),
    ],
    warnings: [],
  };
}
