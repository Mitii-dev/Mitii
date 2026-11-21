import { clampRunEvidence } from "../actions/clampRunEvidence";
import { agentRunResultSchema } from "../contracts";
import type { AgentRunResult, RunEvidence } from "../contracts";

/** Keys a schema failure may never discard: they carry the run outcome itself. */
const CORE_RESULT_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "runId",
  "requestId",
  "status",
  "reasonCodes",
  "warnings",
  "usage",
  "durationMs",
  "error",
  "suspension",
  "answer",
]);

const MAX_DEGRADE_ATTEMPTS = 3;

/**
 * Validate the final run result without letting an optional/derived section
 * (evidence, verification record, repo state, …) discard the run outcome.
 *
 * 1. Strict parse.
 * 2. On failure: clamp evidence to schema limits when evidence is implicated,
 *    then drop other implicated optional sections.
 * 3. Degraded results carry the `result_contract_degraded` reason code and a
 *    warning naming the discarded sections. Failures on core keys still throw.
 */
export function parseAgentRunResultResilient(
  candidate: Record<string, unknown>,
): AgentRunResult {
  const first = agentRunResultSchema.safeParse(candidate);
  if (first.success) return first.data;

  let current: Record<string, unknown> = { ...candidate };
  const degraded: string[] = [];
  let issues = first.error.issues;

  for (let attempt = 0; attempt < MAX_DEGRADE_ATTEMPTS; attempt += 1) {
    const keys = [
      ...new Set(
        issues
          .map((issue) => issue.path[0])
          .filter((key): key is string => typeof key === "string"),
      ),
    ];
    if (keys.length === 0 || keys.some((key) => CORE_RESULT_KEYS.has(key))) {
      throw first.error;
    }
    for (const key of keys) {
      if (key === "evidence" && attempt === 0 && current.evidence) {
        current = {
          ...current,
          evidence: clampRunEvidence(current.evidence as RunEvidence),
        };
        degraded.push("evidence(clamped)");
      } else {
        const { [key]: _removed, ...rest } = current;
        current = rest;
        degraded.push(`${key}(dropped)`);
      }
    }
    const retry = agentRunResultSchema.safeParse(withDegradeMarkers(current, degraded));
    if (retry.success) return retry.data;
    issues = retry.error.issues;
  }
  throw first.error;
}

function withDegradeMarkers(
  candidate: Record<string, unknown>,
  degraded: readonly string[],
): Record<string, unknown> {
  const reasonCodes = Array.isArray(candidate.reasonCodes)
    ? (candidate.reasonCodes as string[])
    : [];
  const warnings = Array.isArray(candidate.warnings)
    ? (candidate.warnings as string[])
    : [];
  return {
    ...candidate,
    reasonCodes: reasonCodes.includes("result_contract_degraded")
      ? reasonCodes
      : [...reasonCodes, "result_contract_degraded"],
    warnings: [
      ...warnings,
      `Run result contract degraded: ${[...new Set(degraded)].join(", ")}.`,
    ],
  };
}
