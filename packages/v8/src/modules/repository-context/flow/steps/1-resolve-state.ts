import type {
  RepositoryContextPipelineInput,
  RepositoryContextPipelineWarning,
  RepositoryContextResolvedState,
  RepositoryContextStateResolverPort,
} from "../../contracts/types";
import { REPOSITORY_CONTEXT_PIPELINE_MESSAGES } from "../../constants";

export type ResolveStateOutcome =
  | {
      status: "ok";
      artifacts: RepositoryContextResolvedState;
      warnings: RepositoryContextPipelineWarning[];
    }
  | {
      status: "failed";
      stateToken: string;
      workspaceSnapshotId: string;
      warnings: RepositoryContextPipelineWarning[];
    };

export async function resolveRepositoryContextState(params: {
  input: RepositoryContextPipelineInput;
  stateResolver: RepositoryContextStateResolverPort;
}): Promise<ResolveStateOutcome> {
  const resolved = await params.stateResolver.resolve(params.input.state);

  if (resolved.status === "not_found") {
    return {
      status: "failed",
      stateToken: params.input.state.stateToken,
      workspaceSnapshotId: "unresolved",
      warnings: [
        {
          stage: "state_resolution",
          code: resolved.code,
          message: resolved.message,
        },
      ],
    };
  }

  if (resolved.status === "unavailable") {
    return {
      status: "failed",
      stateToken: resolved.descriptor.stateToken,
      workspaceSnapshotId: resolved.descriptor.snapshotId,
      warnings: [
        {
          stage: "state_resolution",
          code: resolved.code,
          message: resolved.message,
        },
      ],
    };
  }

  const artifacts = resolved.artifacts;
  const warnings: RepositoryContextPipelineWarning[] = [];

  if (artifacts.descriptor.readiness === "unavailable") {
    return {
      status: "failed",
      stateToken: artifacts.descriptor.stateToken,
      workspaceSnapshotId: artifacts.descriptor.snapshotId,
      warnings: [
        {
          stage: "state_resolution",
          code: "state_unavailable",
          message: REPOSITORY_CONTEXT_PIPELINE_MESSAGES.STATE_UNAVAILABLE,
        },
      ],
    };
  }

  if (artifacts.descriptor.readiness === "degraded") {
    warnings.push({
      stage: "state_resolution",
      code: "state_degraded",
      message: REPOSITORY_CONTEXT_PIPELINE_MESSAGES.STATE_DEGRADED,
    });
  }

  return { status: "ok", artifacts, warnings };
}
