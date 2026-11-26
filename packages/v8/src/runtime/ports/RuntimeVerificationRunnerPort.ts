/** Thin runner seam — modules/verification owns real checks; runtime only invokes. */
export interface RuntimeVerificationOutcome {
  status: "passed" | "failed" | "skipped";
  reasonCodes: string[];
}

export interface RuntimeVerificationRunnerPort {
  run(input: {
    runId: string;
    route?: string;
  }): Promise<RuntimeVerificationOutcome>;
}

/** Default inline adapter until VerificationRunner module wires hosts. */
export function createInlineVerificationRunner(): RuntimeVerificationRunnerPort {
  return {
    async run() {
      return {
        status: "passed",
        reasonCodes: ["verification_runner_inline"],
      };
    },
  };
}
