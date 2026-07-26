import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  discoverCandidatesForProject as discoverByLanguage,
} from "./router";
import type { DiscoveredCheckCandidate, ProjectDiscoveryResult } from "./types";

export type { DiscoveredCheckCandidate, ProjectDiscoveryResult };
export {
  joinRoot,
  packageManagerArgv,
  commandCandidate,
} from "./types";

export async function discoverCandidatesForProject(params: {
  project: ProjectDescriptor;
  changedFiles: readonly string[];
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  return discoverByLanguage(params);
}
