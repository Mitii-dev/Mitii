import type { LanguageId, ProjectDescriptor } from "../../repository-state";

import type {
  VerificationChangeScope,
  VerificationCheckKind,
  VerificationManifestReaderPort,
} from "../contracts";
import { CHECK_KINDS_BY_SCOPE, CHECK_KIND_PRIORITY } from "../policy";
import {
  discoverCandidatesForProject,
  type DiscoveredCheckCandidate,
} from "../internal/discovery";

export type { DiscoveredCheckCandidate };

export interface DiscoverApplicableChecksResult {
  candidates: DiscoveredCheckCandidate[];
  warnings: string[];
}

/**
 * Discover applicable checks from trusted project metadata for affected
 * projects, filtered by change-scope kind allowance.
 */
export async function discoverApplicableChecks(params: {
  projects: readonly ProjectDescriptor[];
  changeScope: VerificationChangeScope;
  changedFiles: readonly string[];
  manifests: VerificationManifestReaderPort;
}): Promise<DiscoverApplicableChecksResult> {
  const allowed = new Set<VerificationCheckKind>(
    CHECK_KINDS_BY_SCOPE[params.changeScope],
  );
  const candidates: DiscoveredCheckCandidate[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const project of params.projects) {
    const discovered = await discoverCandidatesForProject({
      project,
      changedFiles: params.changedFiles,
      manifests: params.manifests,
    });
    for (const candidate of discovered.candidates) {
      if (!allowed.has(candidate.kind)) {
        continue;
      }
      if (seen.has(candidate.checkId)) {
        continue;
      }
      seen.add(candidate.checkId);
      candidates.push(candidate);
    }
    warnings.push(...discovered.warnings);
  }

  // Always allow diagnostics + diff_review as Tool Runtime backed checks when in scope.
  if (allowed.has("diagnostics") && !seen.has("diagnostics:workspace")) {
    candidates.push({
      checkId: "diagnostics:workspace",
      kind: "diagnostics",
      label: "Read workspace diagnostics",
      evidenceSource: "tool:read_diagnostics",
      toolName: "read_diagnostics",
      toolArguments: {
        paths: params.changedFiles.length > 0 ? [...params.changedFiles] : undefined,
      },
      languageId: "unknown" as LanguageId,
    });
  }

  if (allowed.has("diff_review") && !seen.has("diff_review:workspace")) {
    candidates.push({
      checkId: "diff_review:workspace",
      kind: "diff_review",
      label: "Inspect git status and diff",
      evidenceSource: "tool:read_git_status",
      toolName: "read_git_status",
      toolArguments: {
        includeDiff: true,
        paths:
          params.changedFiles.length > 0 ? [...params.changedFiles] : undefined,
      },
      languageId: "unknown" as LanguageId,
    });
  }

  candidates.sort((a, b) => {
    const ai = CHECK_KIND_PRIORITY.indexOf(a.kind);
    const bi = CHECK_KIND_PRIORITY.indexOf(b.kind);
    return ai - bi;
  });

  return { candidates, warnings };
}
