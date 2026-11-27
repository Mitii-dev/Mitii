/**
 * Lift runtime VerificationRequest + host repo pin into modules/verification input.
 */

import {
  DEFAULT_VERIFICATION_COMMAND_PREFIXES,
  READ_ONLY_TOOL_IDS,
  buildVerificationGrant,
  type VerificationRequirement,
} from "../../../modules/decision-policy";
import type { ProjectDescriptor } from "../../../modules/repository-state";
import {
  VERIFICATION_SCHEMA_VERSION,
  type VerificationInput,
} from "../../../modules/verification";
import type { VerificationRequest } from "../../contracts/verify/VerificationRequest";

const EVIDENCE_KINDS = [
  "diagnostics",
  "tests",
  "typecheck",
  "lint",
  "build",
  "diff_review",
  "behavior",
] as const;

type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

function isEvidenceKind(value: string): value is EvidenceKind {
  return (EVIDENCE_KINDS as readonly string[]).includes(value);
}

export function inferProjectsFromChangedFiles(
  changedFiles: readonly string[],
): ProjectDescriptor[] {
  const roots = new Set<string>();
  for (const raw of changedFiles) {
    const file = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    const pkg = /^(packages\/[^/]+)\//.exec(file)?.[1];
    const app = /^(apps\/[^/]+)\//.exec(file)?.[1];
    if (pkg) roots.add(pkg);
    else if (app) roots.add(app);
    else roots.add(".");
  }
  if (roots.size === 0) roots.add(".");
  return [...roots].map((root) => ({
    projectId: root === "." ? "root" : root.replace(/\//g, "-"),
    rootPath: root,
    primaryLanguageId: "typescript" as const,
    manifestPaths:
      root === "." ? ["package.json"] : [`${root}/package.json`],
  }));
}

export function buildVerificationInputFromRequest(params: {
  workspaceRoot: string;
  workspaceId: string;
  stateToken: string;
  stateReadiness?: "ready" | "degraded" | "unavailable";
  request: VerificationRequest;
}): VerificationInput {
  const changedFiles = [
    ...new Set(
      (params.request.changedPaths ?? [])
        .map((path) => path.replace(/\\/g, "/").trim())
        .filter((path) => path.length > 0),
    ),
  ].slice(0, 64);

  const evidence = (params.request.checks ?? []).filter(isEvidenceKind);

  const verification: VerificationRequirement = {
    required: params.request.required !== false,
    minimumEvidence:
      evidence.length > 0
        ? [...evidence]
        : ["diagnostics", "diff_review"],
    allowUnavailable: params.request.allowUnavailable !== false,
    onFailure: params.request.onFailure ?? "report",
    ...(evidence.length > 0 ? { checks: [...evidence] } : {}),
  };

  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    workspaceRoot: params.workspaceRoot,
    pinnedState: {
      workspaceId: params.workspaceId,
      stateToken: params.stateToken,
    },
    changedFiles,
    projects: inferProjectsFromChangedFiles(changedFiles),
    verification,
    grant: buildVerificationGrant({
      maximumWorkspaceEffect: "read",
      allowedTools: [...READ_ONLY_TOOL_IDS],
      allowedEffects: ["workspace_read", "process_execute"],
      pathScopes: ["."],
      commandRules: [
        {
          prefixes: [...DEFAULT_VERIFICATION_COMMAND_PREFIXES],
          allowShellMetacharacters: false,
        },
      ],
      networkHosts: [],
      approvalMode: "never",
      limits: {
        maxToolCalls: 32,
        maxWallTimeMs: 120_000,
        maxOutputBytes: 256_000,
        maxConcurrentTools: 1,
      },
    }),
    changeScope: "localized",
    stateReadiness: params.stateReadiness ?? "ready",
    ...(params.request.budgets?.maxChecks
      ? { maxChecks: params.request.budgets.maxChecks }
      : {}),
  };
}
