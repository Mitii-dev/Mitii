import { commitMemoryOnFinish } from "../verify/CommitMemoryOnFinish";

/** Thin finish-time memory commit sketch (full memory module still owns storage). */
export interface RuntimeMemoryCommitSketch {
  committed: boolean;
  factCount: number;
  reasonCodes: string[];
}

/**
 * Default policy: agent execute success only; skip when verify invalidated.
 * Never dumps transcript / secrets — count is a placeholder for durable facts.
 * Uses S12-MEM `commitMemoryOnFinish` for status/verify gates.
 */
export function commitRuntimeMemory(params: {
  mode: "ask" | "plan" | "agent";
  status: "completed" | "cancelled" | "failed" | "suspended";
  route?: string;
  verify?: {
    ranVerify: boolean;
    invalidated: boolean;
    outcomeStatus?: string;
  };
  memoryEnabled?: boolean;
}): RuntimeMemoryCommitSketch {
  if (params.mode !== "agent") {
    return {
      committed: false,
      factCount: 0,
      reasonCodes: ["memory_commit_skipped"],
    };
  }

  const executeLike =
    params.route === "execute" ||
    params.route === "agent_execute" ||
    params.route === undefined;

  if (!executeLike) {
    return {
      committed: false,
      factCount: 0,
      reasonCodes: ["memory_commit_skipped_non_execute"],
    };
  }

  if (params.verify?.invalidated) {
    return {
      committed: false,
      factCount: 0,
      reasonCodes: ["memory_commit_skipped_verify_invalidated"],
    };
  }

  const policy = commitMemoryOnFinish({
    runStatus: params.status,
    verificationStatus: params.verify?.outcomeStatus,
    hadMutations: true,
    memoryEnabled: params.memoryEnabled !== false,
  });

  if (!policy.shouldCommit) {
    return {
      committed: false,
      factCount: 0,
      reasonCodes: policy.reasonCodes,
    };
  }

  return {
    committed: true,
    factCount: 1,
    reasonCodes: [...policy.reasonCodes, "memory_commit_shell"],
  };
}
