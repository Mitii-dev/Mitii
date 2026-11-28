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

/**
 * Default inline adapter when hosts do not wire VerificationPipeline.
 * Must not report "passed" — that produced hollow verified_success events.
 */
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
        status: "unavailable",
        reasonCodes: [
          "verification_runner_inline",
          "verification_runner_needs_pipeline",
        ],
        checksRun: [],
        summary:
          "Inline stub only — host VerificationPipeline not wired; no checks ran",
      };
    },
  };
}
