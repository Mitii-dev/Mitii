import type { ProjectDescriptor } from "../../../repository-state";

import type { VerificationManifestReaderPort } from "../../contracts";
import {
  commandCandidate,
  joinRoot,
  type ProjectDiscoveryResult,
} from "./types";

export async function discoverPythonChecks(params: {
  project: ProjectDescriptor;
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDiscoveryResult> {
  const root = params.project.rootPath;
  const candidates = [];
  const warnings: string[] = [];

  const pyproject = joinRoot(root, "pyproject.toml");
  const setupCfg = joinRoot(root, "setup.cfg");
  const pytestIni = joinRoot(root, "pytest.ini");
  const toxIni = joinRoot(root, "tox.ini");
  const requirements = joinRoot(root, "requirements.txt");

  const hasPyproject = await params.manifests.exists(pyproject);
  const hasPytest =
    (await params.manifests.exists(pytestIni)) ||
    (await params.manifests.exists(toxIni)) ||
    (hasPyproject &&
      /\[tool\.pytest/i.test(
        (await params.manifests.readText(pyproject)) ?? "",
      ));

  if (hasPytest || hasPyproject || (await params.manifests.exists(requirements))) {
    candidates.push(
      commandCandidate({
        projectId: params.project.projectId,
        kind: "test",
        label: `pytest (${params.project.projectId})`,
        evidenceSource: hasPytest
          ? `manifest:${pytestIni}`
          : `manifest:${hasPyproject ? pyproject : requirements}`,
        languageId: "python",
        argv: root === "." ? ["pytest"] : ["pytest", root],
        mayBeUnavailable: true,
      }),
    );
  }

  if (hasPyproject) {
    const text = (await params.manifests.readText(pyproject)) ?? "";
    if (/\[tool\.mypy\]/i.test(text) || /mypy/i.test(text)) {
      candidates.push(
        commandCandidate({
          projectId: params.project.projectId,
          kind: "typecheck",
          label: `mypy (${params.project.projectId})`,
          evidenceSource: `manifest:${pyproject}#tool.mypy`,
          languageId: "python",
          argv: root === "." ? ["mypy", "."] : ["mypy", root],
          mayBeUnavailable: true,
        }),
      );
    }
    if (/\[tool\.ruff\]/i.test(text) || /ruff/i.test(text)) {
      candidates.push(
        commandCandidate({
          projectId: params.project.projectId,
          kind: "lint",
          label: `ruff check (${params.project.projectId})`,
          evidenceSource: `manifest:${pyproject}#tool.ruff`,
          languageId: "python",
          argv: root === "." ? ["ruff", "check", "."] : ["ruff", "check", root],
          mayBeUnavailable: true,
        }),
      );
    }
  } else if (await params.manifests.exists(setupCfg)) {
    warnings.push(
      `setup.cfg present for "${params.project.projectId}" but no pytest/mypy/ruff evidence — no checks invented.`,
    );
  }

  if (candidates.length === 0) {
    warnings.push(
      `No trusted Python verification tooling discovered for "${params.project.projectId}".`,
    );
  }

  return { candidates, warnings };
}
