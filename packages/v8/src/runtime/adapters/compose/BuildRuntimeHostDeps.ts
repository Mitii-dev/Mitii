/**
 * Map host/SDK compose options onto composeRuntime enrich / memory / verify.
 */

import { MemoryPipeline } from "../../../modules/memory";
import type { MemoryEmbeddingPort, MemoryStorePort } from "../../../modules/memory";
import type { RepositoryContextPipeline } from "../../../modules/repository-context";
import type { RepositoryStatePipeline } from "../../../modules/repository-state";
import { SkillsPipeline } from "../../../modules/skills";
import type { SkillsCatalogPort } from "../../../modules/skills";
import type { VerificationPipeline } from "../../../modules/verification";
import type { ComposeRuntimeOptions } from "./ComposeRuntime";
import { createMemoryPipelineRetrieval } from "../enrich/CreateMemoryPipelineRetrieval";
import { createSkillsPipelineRetrieval } from "../enrich/CreateSkillsPipelineRetrieval";
import type { RuntimeEnrichRetrievalPorts } from "../../ports/RuntimeEnrichRetrievalPorts";
import type { RuntimeRepoContextRetrievalPort } from "../../ports/RuntimeEnrichRetrievalPorts";
import { createMemoryPipelineCommit } from "../memory/CreateMemoryPipelineCommit";
import type { VerificationInputFactory } from "../verification/CreatePipelineVerificationRunner";
import { buildVerificationInputFromRequest } from "./BuildVerificationInputFromRequest";

export type BuildRuntimeHostDepsInput = {
  skillsCatalog?: SkillsCatalogPort;
  memoryStore?: MemoryStorePort;
  memoryEmbedding?: MemoryEmbeddingPort;
  repositoryContext?: RepositoryContextPipeline;
  repositoryState?: RepositoryStatePipeline;
  verification?: VerificationPipeline;
  workspaceId?: string;
  workspaceRoot?: string;
};

export type RuntimeHostComposeSlice = Pick<
  ComposeRuntimeOptions,
  | "enrich"
  | "memoryCommit"
  | "verificationPipeline"
  | "verificationInput"
>;

/**
 * Build shell-side host adapters from the same ports hosts already pass
 * into composeAgentEngine / composeV8Engine.
 */
export function buildRuntimeHostDeps(
  input: BuildRuntimeHostDepsInput,
): RuntimeHostComposeSlice {
  const workspaceId = input.workspaceId?.trim() || "runtime";
  const enrich = buildEnrichPorts(input, workspaceId);
  const memoryPipeline = input.memoryStore
    ? new MemoryPipeline({
        store: input.memoryStore,
        embedding: input.memoryEmbedding,
      })
    : undefined;

  const slice: RuntimeHostComposeSlice = {};
  if (enrich) slice.enrich = enrich;
  if (memoryPipeline) {
    slice.memoryCommit = createMemoryPipelineCommit({
      pipeline: memoryPipeline,
      defaultWorkspaceId: workspaceId,
    });
  }
  if (input.verification) {
    slice.verificationPipeline = input.verification;
    slice.verificationInput = buildVerificationInputFactory({
      workspaceRoot: input.workspaceRoot,
      repositoryState: input.repositoryState,
      workspaceId,
    });
  }
  return slice;
}

function buildEnrichPorts(
  input: BuildRuntimeHostDepsInput,
  workspaceId: string,
): RuntimeEnrichRetrievalPorts | undefined {
  const skills = input.skillsCatalog
    ? createSkillsPipelineRetrieval({
        pipeline: new SkillsPipeline({ catalog: input.skillsCatalog }),
      })
    : undefined;
  const memory = input.memoryStore
    ? createMemoryPipelineRetrieval({
        pipeline: new MemoryPipeline({
          store: input.memoryStore,
          embedding: input.memoryEmbedding,
        }),
        scope: { kind: "workspace", workspaceId },
      })
    : undefined;
  const repo =
    input.repositoryContext && input.repositoryState
      ? createLatestRepoRetrieval({
          pipeline: input.repositoryContext,
          repositoryState: input.repositoryState,
          workspaceId,
        })
      : undefined;

  if (!skills && !memory && !repo) return undefined;
  return {
    ...(skills ? { skills } : {}),
    ...(memory ? { memory } : {}),
    ...(repo ? { repo } : {}),
  };
}

/**
 * Resolve latest published state then run repository-context (async getLatest).
 */
function createLatestRepoRetrieval(options: {
  pipeline: RepositoryContextPipeline;
  repositoryState: RepositoryStatePipeline;
  workspaceId: string;
}): RuntimeRepoContextRetrievalPort {
  return {
    async retrieve(input) {
      const max = input.maxItems ?? 24;
      const latest = await options.repositoryState.getLatest(
        options.workspaceId,
      );
      if (!latest) {
        const stubs = input.focusPaths.slice(0, max);
        return {
          slices: stubs,
          reasonCodes: [
            "repo_pipeline_no_latest_state",
            ...(stubs.length > 0 ? ["enrich_repo_focus_stub"] : []),
          ],
        };
      }

      try {
        const result = await options.pipeline.execute({
          state: {
            workspaceId: latest.workspaceId,
            stateToken: latest.stateToken,
          },
          query:
            input.focusPaths.length > 0
              ? `Focus: ${input.focusPaths.slice(0, 8).join(", ")}`
              : "repository overview",
          mode: "ask",
          ...(input.focusPaths.length > 0
            ? { filePaths: [...input.focusPaths].slice(0, 32) }
            : {}),
        });

        const slices = result.assembly.blocks
          .slice(0, max)
          .map((block) => {
            const path = block.relativePath;
            const content = block.content?.trim() ?? "";
            if (path && content) return `${path}\n${content.slice(0, 2_000)}`;
            if (path) return path;
            return content.slice(0, 2_000);
          })
          .filter(Boolean);

        return {
          slices:
            slices.length > 0
              ? slices
              : input.focusPaths.slice(0, max),
          reasonCodes: [
            "repo_pipeline_retrieved",
            `repo_status_${result.status}`,
          ],
        };
      } catch {
        return {
          slices: input.focusPaths.slice(0, max),
          reasonCodes: ["repo_pipeline_retrieve_failed"],
        };
      }
    },
  };
}

function buildVerificationInputFactory(options: {
  workspaceRoot?: string;
  repositoryState?: RepositoryStatePipeline;
  workspaceId: string;
}): VerificationInputFactory {
  return async ({ request }) => {
    if (!options.workspaceRoot || !options.repositoryState) {
      return undefined;
    }
    if (!request) return undefined;
    const latest = await options.repositoryState.getLatest(options.workspaceId);
    if (!latest) return undefined;
    return buildVerificationInputFromRequest({
      workspaceRoot: options.workspaceRoot,
      workspaceId: latest.workspaceId,
      stateToken: latest.stateToken,
      stateReadiness:
        latest.readiness === "ready" ||
        latest.readiness === "degraded" ||
        latest.readiness === "unavailable"
          ? latest.readiness
          : "ready",
      request,
    });
  };
}
