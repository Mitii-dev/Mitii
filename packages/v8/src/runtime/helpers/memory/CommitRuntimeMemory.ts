import { commitMemoryOnFinish } from "../verify/CommitMemoryOnFinish";
import type { RuntimeMemoryCommitPort } from "../../ports/RuntimeMemoryCommitPort";
import { buildFinishMemoryContent } from "./BuildFinishMemoryContent";

/** Thin finish-time memory commit sketch (full memory module still owns storage). */
export interface RuntimeMemoryCommitSketch {
  committed: boolean;
  factCount: number;
  memoryId?: string;
  reasonCodes: string[];
}

export interface CommitRuntimeMemoryParams {
  mode: "ask" | "plan" | "agent";
  status: "completed" | "cancelled" | "failed" | "suspended";
  route?: string;
  verify?: {
    ranVerify: boolean;
    invalidated: boolean;
    outcomeStatus?: string;
  };
  memoryEnabled?: boolean;
  /** When set, policy-allowed commits go through the memory module. */
  commitPort?: RuntimeMemoryCommitPort;
  objective?: string;
  answerSummary?: string;
  changedPaths?: readonly string[];
  workspaceId?: string;
  projectId?: string;
  runId?: string;
  hadMutations?: boolean;
}

/**
 * Default policy: agent execute success only; skip when verify invalidated.
 * Uses S12-MEM `commitMemoryOnFinish` for status/verify gates; optional
 * RuntimeMemoryCommitPort persists via modules/memory (S11-MEM).
 */
export function commitRuntimeMemory(
  params: CommitRuntimeMemoryParams,
): RuntimeMemoryCommitSketch {
  const gated = gateCommit(params);
  if (!gated.shouldCommit) {
    return {
      committed: false,
      factCount: 0,
      reasonCodes: gated.reasonCodes,
    };
  }
  return {
    committed: true,
    factCount: 1,
    reasonCodes: [...gated.reasonCodes, "memory_commit_shell"],
  };
}

/**
 * Async finish commit — policy then optional MemoryPipeline port.
 */
export async function commitRuntimeMemoryAsync(
  params: CommitRuntimeMemoryParams,
): Promise<RuntimeMemoryCommitSketch> {
  const gated = gateCommit(params);
  if (!gated.shouldCommit) {
    return {
      committed: false,
      factCount: 0,
      reasonCodes: gated.reasonCodes,
    };
  }

  if (!params.commitPort) {
    return {
      committed: true,
      factCount: 1,
      reasonCodes: [...gated.reasonCodes, "memory_commit_shell"],
    };
  }

  const content = buildFinishMemoryContent({
    route: params.route,
    objective: params.objective,
    answerSummary: params.answerSummary,
    changedPaths: params.changedPaths,
    verifyStatus: params.verify?.outcomeStatus,
  });

  const result = await params.commitPort.commit({
    content,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    files: params.changedPaths,
    title: params.objective?.slice(0, 80),
    runId: params.runId,
    tags: ["runtime_finish", params.route ?? "execute"].filter(Boolean),
  });

  if (!result.ok) {
    return {
      committed: false,
      factCount: 0,
      reasonCodes: [...gated.reasonCodes, ...result.reasonCodes],
    };
  }

  return {
    committed: true,
    factCount: 1,
    memoryId: result.memoryId,
    reasonCodes: [
      ...gated.reasonCodes,
      "memory_commit_module",
      ...result.reasonCodes,
    ],
  };
}

function gateCommit(params: CommitRuntimeMemoryParams): {
  shouldCommit: boolean;
  reasonCodes: string[];
} {
  if (params.mode !== "agent") {
    return {
      shouldCommit: false,
      reasonCodes: ["memory_commit_skipped"],
    };
  }

  const executeLike =
    params.route === "execute" ||
    params.route === "agent_execute" ||
    params.route === undefined;

  if (!executeLike) {
    return {
      shouldCommit: false,
      reasonCodes: ["memory_commit_skipped_non_execute"],
    };
  }

  if (params.verify?.invalidated) {
    return {
      shouldCommit: false,
      reasonCodes: ["memory_commit_skipped_verify_invalidated"],
    };
  }

  return commitMemoryOnFinish({
    runStatus: params.status,
    verificationStatus: params.verify?.outcomeStatus,
    hadMutations: params.hadMutations !== false,
    memoryEnabled: params.memoryEnabled !== false,
  });
}
