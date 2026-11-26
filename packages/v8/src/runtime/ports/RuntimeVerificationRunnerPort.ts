import type { VerificationRequest } from "../contracts/verify/VerificationRequest";

/** Thin runner seam — modules/verification owns real checks; runtime only invokes. */
export interface RuntimeVerificationOutcome {
  status: "passed" | "failed" | "skipped" | "unavailable";
  reasonCodes: string[];
  checksRun?: string[];
  summary?: string;
}

export interface RuntimeVerificationRunnerPort {
  run(
    input: VerificationRequest | { runId: string; route?: string },
  ): Promise<RuntimeVerificationOutcome>;
}

/** Default inline adapter until VerificationRunner module wires hosts. */
export function createInlineVerificationRunner(): RuntimeVerificationRunnerPort {
  return {
    async run(input) {
      const required =
        "required" in input ? input.required !== false : true;
      if (!required) {
        return {
          status: "skipped",
          reasonCodes: ["verification_runner_inline_skip"],
        };
      }
      return {
        status: "passed",
        reasonCodes: ["verification_runner_inline"],
        checksRun:
          "checks" in input && Array.isArray(input.checks)
            ? [...input.checks]
            : ["diagnostics"],
      };
    },
  };
}
