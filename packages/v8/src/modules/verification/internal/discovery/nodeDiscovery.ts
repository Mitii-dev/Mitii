import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import { NODE_SCRIPT_CANDIDATES, PLACEHOLDER_TEST_SCRIPT } from "../../policy";
import {
  joinRoot,
  packageManagerArgv,
  type DiscoveredCheckCandidate,
  type ProjectDiscoveryResult,
} from "./types";

interface PackageJson {
  scripts?: Record<string, string>;
  packageManager?: string;
}

export async function discoverNodeChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const pkgPath = joinRoot(params.project.rootPath, "package.json");
  const raw = await params.manifests.readText(pkgPath);
  if (!raw) {
    return {
      candidates: [],
      warnings: [
        `No package.json at "${pkgPath}" for project "${params.project.projectId}".`,
      ],
    };
  }

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    return {
      candidates: [],
      warnings: [`Invalid package.json JSON at "${pkgPath}".`],
    };
  }

  const scripts = pkg.scripts ?? {};
  const pm = detectPackageManager(pkg.packageManager);
  const candidates: DiscoveredCheckCandidate[] = [];
  const warnings: string[] = [];

  for (const [kind, names] of Object.entries(NODE_SCRIPT_CANDIDATES) as Array<
    [keyof typeof NODE_SCRIPT_CANDIDATES, readonly string[]]
  >) {
    const script = names.find((name) => {
      if (!(name in scripts)) return false;
      if (
        name === "test" &&
        PLACEHOLDER_TEST_SCRIPT.test(scripts[name] ?? "")
      ) {
        return false;
      }
      return true;
    });
    if (!script) {
      continue;
    }
    const argv = packageManagerArgv(pm, script, params.project.rootPath);
    candidates.push({
      checkId: `${params.project.projectId}:${kind}:${script}`,
      kind,
      projectId: params.project.projectId,
      label: `${pm} ${script} (${params.project.projectId})`,
      evidenceSource: `manifest:${pkgPath}#scripts.${script}`,
      languageId: params.project.primaryLanguageId,
      toolName: "run_readonly_command",
      toolArguments: { argv },
      argv,
    });
  }

  if (candidates.length === 0) {
    warnings.push(
      `package.json at "${pkgPath}" has no discoverable typecheck/lint/test/build scripts.`,
    );
  }

  return { candidates, warnings };
}

function detectPackageManager(
  field: string | undefined,
): "npm" | "pnpm" | "yarn" | "bun" {
  if (field?.startsWith("pnpm@")) return "pnpm";
  if (field?.startsWith("yarn@")) return "yarn";
  if (field?.startsWith("bun@")) return "bun";
  return "npm";
}
