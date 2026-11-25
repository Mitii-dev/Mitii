import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

export async function discoverDotnetChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const root = params.project.rootPath;
  const csprojCandidates = [
    joinRoot(root, `${params.project.projectId}.csproj`),
    joinRoot(root, "App.csproj"),
  ];

  let csproj: string | undefined;
  for (const candidate of csprojCandidates) {
    if (await params.manifests.exists(candidate)) {
      csproj = candidate;
      break;
    }
  }

  // Also accept any *.csproj listed via a simple Directory.Build.props / solution marker.
  const sln = joinRoot(root, "App.sln");
  const dirBuild = joinRoot(root, "Directory.Build.props");
  const hasDirBuild = await params.manifests.exists(dirBuild);
  const hasSln = await params.manifests.exists(sln);

  if (!csproj && !hasSln && !hasDirBuild) {
    // Probe common project file name from project root listing is not available;
    // require an explicit marker.
    return {
      candidates: [],
      warnings: [
        `No .csproj/.sln/Directory.Build.props for "${params.project.projectId}" — C# checks unavailable.`,
      ],
    };
  }

  const target = csproj ?? (hasSln ? sln : root === "." ? "." : root);

  return {
    candidates: [
      commandCandidate({
        projectId: params.project.projectId,
        kind: "build",
        label: `dotnet build (${params.project.projectId})`,
        evidenceSource: `manifest:${csproj ?? sln ?? dirBuild}`,
        languageId: "csharp",
        argv: ["dotnet", "build", target],
        mayBeUnavailable: true,
      }),
      commandCandidate({
        projectId: params.project.projectId,
        kind: "test",
        label: `dotnet test (${params.project.projectId})`,
        evidenceSource: `manifest:${csproj ?? sln ?? dirBuild}`,
        languageId: "csharp",
        argv: ["dotnet", "test", target, "--no-build"],
        mayBeUnavailable: true,
      }),
    ],
    warnings: [],
  };
}
