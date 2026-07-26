import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import { discoverNodeChecks } from "./nodeDiscovery";
import { discoverPythonChecks } from "./pythonDiscovery";
import { discoverGoChecks } from "./goDiscovery";
import { discoverRustChecks } from "./rustDiscovery";
import { discoverJvmChecks } from "./jvmDiscovery";
import { discoverDotnetChecks } from "./dotnetDiscovery";
import { discoverCppChecks } from "./cppDiscovery";
import { discoverRubyChecks } from "./rubyDiscovery";
import { discoverPhpChecks } from "./phpDiscovery";
import { discoverSwiftChecks } from "./swiftDiscovery";
import { discoverShellChecks } from "./shellDiscovery";
import { discoverSqlChecks } from "./sqlDiscovery";
import { joinRoot, type ProjectDiscoveryResult } from "./types";

export async function discoverCandidatesForProject(params: {
  project: ProjectDescriptor;
  changedFiles: readonly string[];
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const language = params.project.primaryLanguageId;

  switch (language) {
    case "typescript":
    case "javascript":
      return discoverNodeChecks(params);
    case "python":
      return discoverPythonChecks(params);
    case "go":
      return discoverGoChecks(params);
    case "rust":
      return discoverRustChecks(params);
    case "java":
    case "kotlin":
      return discoverJvmChecks(params);
    case "csharp":
      return discoverDotnetChecks(params);
    case "c":
    case "cpp":
      return discoverCppChecks(params);
    case "ruby":
      return discoverRubyChecks(params);
    case "php":
      return discoverPhpChecks(params);
    case "swift":
      return discoverSwiftChecks(params);
    case "shell":
      return discoverShellChecks(params);
    case "sql":
      return discoverSqlChecks(params);
    case "unknown":
    default:
      return discoverUnknownFallback(params);
  }
}

async function discoverUnknownFallback(params: {
  project: ProjectDescriptor;
  changedFiles?: readonly string[];
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const pkgPath = joinRoot(params.project.rootPath, "package.json");
  if (await params.manifests.exists(pkgPath)) {
    return discoverNodeChecks(params);
  }
  return {
    candidates: [],
    warnings: [
      `No trusted verification manifests discovered for project "${params.project.projectId}" (language=unknown).`,
    ],
  };
}
