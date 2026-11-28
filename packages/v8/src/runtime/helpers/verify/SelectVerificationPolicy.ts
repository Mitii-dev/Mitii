/**
 * Policy: skip vs run verification (S12-SELECT) — never accidental skip.
 */

import type { VerificationBaselineSnapshot } from "../../contracts/verify/VerificationBaselineSnapshot";
import type { VerificationRequest } from "../../contracts/verify/VerificationRequest";
import { verificationRequestSchema } from "../../contracts/verify/VerificationRequest";
import {
  orderChecksFastFirst,
  selectPolicyForChangedPaths,
  type VerificationCheckKind,
} from "./ChangeClassSelectTable";
import { discoverChecksFromCatalog } from "./DiscoverChecksFromCatalog";
import {
  resolveVerificationBudgets,
  type VerificationBudgets,
} from "./VerificationBudgets";

export interface SelectVerificationPolicyInput {
  runId: string;
  route?: string;
  /** From ExecutionDecision.verification / runtime decide sketch. */
  verification?: {
    required?: boolean;
    checks?: readonly string[];
    minimumEvidence?: readonly string[];
    allowUnavailable?: boolean;
    onFailure?: "retry" | "report" | "block";
  };
  /** Route body said runVerify. */
  runVerify?: boolean;
  changedPaths?: readonly string[];
  workspaceRoot?: string;
  repairPass?: number;
  baselineSnapshot?: VerificationBaselineSnapshot;
  budgets?: Partial<VerificationBudgets>;
  /** Catalog projects for S12-DISCOVER script hints. */
  catalogProjects?: readonly {
    id: string;
    scripts?: Record<string, string>;
    testRoots?: readonly string[];
  }[];
  /** Explicit opt-in for e2e/emulator (S12-HEAVY). */
  allowHeavy?: boolean;
}

export interface SelectVerificationPolicyResult {
  skip: boolean;
  request?: VerificationRequest;
  reasonCodes: string[];
}

const CHECK_KINDS = new Set([
  "diagnostics",
  "tests",
  "typecheck",
  "lint",
  "build",
  "diff_review",
  "behavior",
]);

/**
 * Build a VerificationRequest or skip with explicit reason codes.
 */
export function selectVerificationPolicy(
  input: SelectVerificationPolicyInput,
): SelectVerificationPolicyResult {
  const required = input.verification?.required === true;
  const runVerify = input.runVerify === true;

  if (!required && !runVerify) {
    return {
      skip: true,
      reasonCodes: ["verify_policy_skip_not_required"],
    };
  }

  const rawChecks = [
    ...(input.verification?.checks ?? []),
    ...(input.verification?.minimumEvidence ?? []),
  ];
  let checks: VerificationRequest["checks"] = [
    ...new Set(
      rawChecks.filter((c): c is VerificationRequest["checks"][number] =>
        CHECK_KINDS.has(c),
      ),
    ),
  ];

  const changePolicy = selectPolicyForChangedPaths(input.changedPaths ?? []);
  const selectCodes: string[] = [
    changePolicy.reasonCode,
    `verify_change_class_${changePolicy.changeClass}`,
  ];

  const discoverCodes: string[] = [];
  if (required && checks.length === 0) {
    // Prefer change-class preferred checks before catalog discovery.
    const preferred = orderChecksFastFirst([
      ...changePolicy.preferredChecks,
    ]) as VerificationRequest["checks"];
    checks.push(...preferred.filter((c) => CHECK_KINDS.has(c)));

    if (changePolicy.skipTests) {
      checks = checks.filter((c) => c !== "tests");
      selectCodes.push("verify_select_omit_tests_by_class");
    }

    if (checks.length === 0) {
      const discovered = discoverChecksFromCatalog({
        projects: input.catalogProjects,
        allowHeavy: input.allowHeavy,
      });
      checks.push(...discovered.checks);
      discoverCodes.push(...discovered.reasonCodes);
    }
  } else if (checks.length > 0 && changePolicy.skipTests && !required) {
    // Explicit non-required path: still honor docs/types skip-tests table.
    const before = checks.length;
    checks = checks.filter((c) => c !== "tests");
    if (checks.length < before) {
      selectCodes.push("verify_select_omit_tests_by_class");
    }
  }

  if (required && checks.length === 0) {
    // Required verify with empty checks → still run diagnostics + diff_review.
    checks.push("diagnostics", "diff_review");
  }

  checks = orderChecksFastFirst(
    checks as VerificationCheckKind[],
  ) as VerificationRequest["checks"];

  const request = verificationRequestSchema.parse({
    schemaVersion: 1,
    runId: input.runId,
    route: input.route,
    required: required || runVerify,
    checks,
    allowUnavailable: input.verification?.allowUnavailable ?? true,
    onFailure: input.verification?.onFailure ?? "report",
    repairPass: input.repairPass ?? 0,
    maxRepairPasses: 2,
    changedPaths: [...(input.changedPaths ?? [])].slice(0, 64),
    workspaceRoot: input.workspaceRoot,
    ...(input.baselineSnapshot
      ? { baselineSnapshot: input.baselineSnapshot }
      : {}),
    budgets: resolveVerificationBudgets(input.budgets),
  });

  return {
    skip: false,
    request,
    reasonCodes: [
      "verify_policy_run",
      ...(required ? ["verify_policy_required"] : ["verify_policy_route_body"]),
      ...selectCodes,
      ...discoverCodes,
    ],
  };
}
