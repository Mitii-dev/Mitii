/** Thin finish-time memory commit sketch (full memory module still owns storage). */
export interface RuntimeMemoryCommitSketch {
  committed: boolean;
  factCount: number;
  reasonCodes: string[];
}

/**
 * Default policy: agent execute success only; skip when verify invalidated.
 * Never dumps transcript / secrets — count is a placeholder for durable facts.
 */
export function commitRuntimeMemory(params: {
  mode: "ask" | "plan" | "agent";
  status: "completed" | "cancelled" | "failed" | "suspended";
  route?: string;
  verify?: { ranVerify: boolean; invalidated: boolean };
}): RuntimeMemoryCommitSketch {
  if (params.status !== "completed" || params.mode !== "agent") {
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

  return {
    committed: true,
    factCount: 1,
    reasonCodes: ["memory_commit_shell"],
  };
}
