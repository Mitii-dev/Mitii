import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

export async function discoverRubyChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const root = params.project.rootPath;
  const gemfile = joinRoot(root, "Gemfile");
  const rakefile = joinRoot(root, "Rakefile");

  if (!(await params.manifests.exists(gemfile))) {
    return {
      candidates: [],
      warnings: [
        `No Gemfile for "${params.project.projectId}" — Ruby checks unavailable.`,
      ],
    };
  }

  const candidates = [
    commandCandidate({
      projectId: params.project.projectId,
      kind: "test",
      label: `bundle exec rspec (${params.project.projectId})`,
      evidenceSource: `manifest:${gemfile}`,
      languageId: "ruby",
      argv: ["bundle", "exec", "rspec"],
      mayBeUnavailable: true,
    }),
  ];

  if (await params.manifests.exists(rakefile)) {
    candidates.push(
      commandCandidate({
        projectId: params.project.projectId,
        kind: "test",
        label: `rake test (${params.project.projectId})`,
        evidenceSource: `manifest:${rakefile}`,
        languageId: "ruby",
        argv: ["bundle", "exec", "rake", "test"],
        mayBeUnavailable: true,
      }),
    );
  }

  return { candidates, warnings: [] };
}
