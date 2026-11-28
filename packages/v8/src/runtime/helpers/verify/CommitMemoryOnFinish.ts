/**
 * Finish-time memory commit policy (S12-MEM) — decides whether to commit.
 * Actual MemoryPipeline call stays host/module-owned.
 */

export interface CommitMemoryOnFinishInput {
  runStatus: "completed" | "failed" | "suspended" | "cancelled";
  verificationStatus?: string;
  /** Route executed mutations this run. */
  hadMutations?: boolean;
  /** Host opted into memory. */
  memoryEnabled?: boolean;
}

export interface CommitMemoryOnFinishResult {
  shouldCommit: boolean;
  reasonCodes: string[];
}

/**
 * Commit durable memory only on successful finishes with real work.
 * Never commit on suspended/cancelled or blocked verification.
 */
export function commitMemoryOnFinish(
  input: CommitMemoryOnFinishInput,
): CommitMemoryOnFinishResult {
  if (!input.memoryEnabled) {
    return {
      shouldCommit: false,
      reasonCodes: ["memory_commit_disabled"],
    };
  }
  if (input.runStatus !== "completed") {
    return {
      shouldCommit: false,
      reasonCodes: ["memory_commit_skip_not_completed"],
    };
  }
  if (
    input.verificationStatus === "blocked" ||
    input.verificationStatus === "repair_capped"
  ) {
    return {
      shouldCommit: false,
      reasonCodes: ["memory_commit_skip_verify_bad"],
    };
  }
  if (!input.hadMutations && input.verificationStatus === "skipped") {
    return {
      shouldCommit: false,
      reasonCodes: ["memory_commit_skip_no_work"],
    };
  }
  return {
    shouldCommit: true,
    reasonCodes: ["memory_commit_allowed"],
  };
}
