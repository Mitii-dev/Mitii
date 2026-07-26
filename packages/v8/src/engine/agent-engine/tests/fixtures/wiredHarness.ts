import type {
  LlmPort,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
  ModelToolCall,
} from "../../../../modules/model-gateway";
import { EchoLlmPort } from "../../../../modules/model-gateway";
import { RepositoryContextPipeline } from "../../../../modules/repository-context";
import type {
  RepositoryContextPipelineDependencies,
  RepositoryContextStateResolveResult,
} from "../../../../modules/repository-context";
import {
  InMemoryRepositoryStateStore,
  RepositoryStatePipeline,
} from "../../../../modules/repository-state";
import type {
  RepositoryStateDescriptor,
  RepositoryStateReference,
  WorkspaceSnapshot,
} from "../../../../modules/repository-state";
import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
} from "../../../tool-runtime";

import { composeReadOnlyAgentEngine } from "../..";
import type { AgentEnginePipeline } from "../../pipeline/AgentEnginePipeline";
import { DEFAULT_READ_ONLY_TOOL_DEFINITIONS } from "../../policy";
import { ScriptedLlmPort, createCapabilities } from "./stubs";

export const WIRED_WORKSPACE_ROOT = "/workspace";
export const WIRED_WORKSPACE_ID = "ws_engine";
export const WIRED_FIXED_NOW = Date.parse("2026-07-25T12:00:00.000Z");

/**
 * Structured classification LLM for Request Understanding.
 */
export class UnderstandingLlmPort implements LlmPort {
  public readonly id = "wired-understanding-llm";
  public readonly capabilities: ModelCapabilities = createCapabilities({
    modelId: "test/understanding",
    supportsTools: false,
    supportsStructuredOutput: true,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  });

  constructor(private readonly response: Record<string, unknown>) {}

  public async *complete(
    _request: ModelRequest,
  ): AsyncIterable<ModelEvent> {
    yield {
      type: "content_delta",
      content: JSON.stringify(this.response),
    };
    yield { type: "completed", finishReason: "stop" };
  }
}

export function understandingClassification(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    interactionIntent: "question",
    primaryTaskIntent: "question",
    secondaryTaskIntents: [],
    confidence: 0.94,
    alternatives: [],
    needsClarification: false,
    reason: "Wired fixture classification.",
    ...overrides,
  };
}

export interface WiredHarness {
  engine: AgentEnginePipeline;
  repositoryState: RepositoryStatePipeline;
  stateReference: RepositoryStateReference;
  descriptor: RepositoryStateDescriptor;
  tools: ToolRuntimePipeline;
}

export interface CreateWiredHarnessOptions {
  understanding?: Record<string, unknown>;
  runLlm?: LlmPort;
  /** When set, use ScriptedLlmPort turns instead of Echo. */
  runTurns?: Array<{
    content?: string;
    toolCalls?: ModelToolCall[];
    fail?: { code: string; message: string };
    cancel?: boolean;
  }>;
  runCapabilities?: Partial<ModelCapabilities>;
}

/**
 * Compose real Intake / Understanding / Decision / Prompt / State / Context /
 * Tool Runtime facades for Phase 7 end-to-end tests.
 */
export async function createWiredHarness(
  options: CreateWiredHarnessOptions = {},
): Promise<WiredHarness> {
  const store = new InMemoryRepositoryStateStore();
  const repositoryState = new RepositoryStatePipeline({
    store,
    clock: { now: () => new Date(WIRED_FIXED_NOW) },
  });

  const published = await repositoryState.publish({
    schemaVersion: 1,
    workspaceId: WIRED_WORKSPACE_ID,
    snapshotId: "snap_engine_1",
    scanCompleteness: "complete",
    roots: [
      {
        rootId: "root",
        projectCatalogRevision: "catalog-1",
        codeIndexRevision: "code-1",
        textIndexRevision: "text-1",
        capabilities: [
          { capability: "catalog", status: "ready" },
          { capability: "codeIndex", status: "ready" },
          { capability: "textIndex", status: "ready" },
        ],
      },
    ],
    reasons: [],
    generatedAt: new Date(WIRED_FIXED_NOW).toISOString(),
  });

  if (published.status !== "published") {
    throw new Error(`Failed to publish wired state: ${published.status}`);
  }

  const snapshot: WorkspaceSnapshot = {
    schemaVersion: 1,
    snapshotId: published.descriptor.snapshotId,
    roots: [
      {
        id: "root",
        name: "root",
        kind: "directory",
      },
    ],
    entries: [
      {
        kind: "file",
        rootId: "root",
        relativePath: "src/auth.ts",
        depth: 2,
        size: 40,
      },
    ],
    warnings: [],
    statistics: {
      files: 1,
      directories: 1,
      symbolicLinks: 0,
      otherEntries: 0,
      ignoredEntries: 0,
      warnings: 0,
      durationMs: 0,
    },
    limits: {
      maximumDepth: 10,
      maximumFiles: 100,
      maximumDirectories: 100,
      timeoutMs: 1_000,
      followSymbolicLinks: false,
    },
    status: "complete",
    generatedAt: new Date(WIRED_FIXED_NOW).toISOString(),
  };

  const repositoryContext = new RepositoryContextPipeline(
    createOneBlockContextDeps(published.descriptor, snapshot),
  );

  const tools = new ToolRuntimePipeline({
    fileSystem: new InMemoryFileSystemAdapter(
      WIRED_WORKSPACE_ROOT,
      directory({
        src: directory({
          "auth.ts": file(
            "export function login() {\n  return true;\n}\n",
          ),
        }),
        README: file("engine fixture\n"),
      }),
    ),
    process: new InMemoryProcessAdapter(async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      cancelled: false,
      truncated: false,
    })),
  });

  const runLlm =
    options.runLlm ??
    (options.runTurns
      ? new ScriptedLlmPort(
          options.runTurns,
          createCapabilities({
            supportsTools: true,
            ...options.runCapabilities,
          }),
        )
      : new EchoLlmPort());

  const engine = composeReadOnlyAgentEngine({
    understandingLlm: new UnderstandingLlmPort(
      understandingClassification(options.understanding),
    ),
    runLlm,
    repositoryState,
    repositoryContext,
    tools,
    toolDefinitions: DEFAULT_READ_ONLY_TOOL_DEFINITIONS,
    intake: {
      clock: { now: () => WIRED_FIXED_NOW },
      idGenerator: {
        generate: (namespace: string) => `${namespace}_wired_1`,
      },
    },
    clock: { now: () => new Date(WIRED_FIXED_NOW) },
    idGenerator: { next: (prefix: string) => `${prefix}_wired_1` },
  });

  return {
    engine,
    repositoryState,
    stateReference: published.reference,
    descriptor: published.descriptor,
    tools,
  };
}

function createOneBlockContextDeps(
  descriptor: RepositoryStateDescriptor,
  snapshot: WorkspaceSnapshot,
): RepositoryContextPipelineDependencies {
  return {
    stateResolver: {
      resolve: async (
        reference: RepositoryStateReference,
      ): Promise<RepositoryContextStateResolveResult> => {
        if (
          reference.workspaceId !== descriptor.workspaceId ||
          reference.stateToken !== descriptor.stateToken
        ) {
          return {
            status: "not_found",
            code: "unknown_state_token",
            message: "Unknown state token.",
          };
        }
        return {
          status: "resolved",
          artifacts: { descriptor, snapshot },
        };
      },
    },
    retriever: {
      retrieve: async (input) =>
        ({
          schemaVersion: 1,
          query: input.query,
          status: "empty",
          candidates: [],
          sourceReports: [],
          warnings: [],
          truncated: false,
          statistics: {
            configuredSources: 0,
            attemptedSources: 0,
            successfulSources: 0,
            failedSources: 0,
            skippedSources: 0,
            sourceCandidates: 0,
            uniqueCandidates: 0,
            duplicateCandidatesRemoved: 0,
            returnedCandidates: 0,
          },
        }) as Awaited<
          ReturnType<RepositoryContextPipelineDependencies["retriever"]["retrieve"]>
        >,
    },
    selector: {
      select: (input) =>
        ({
          schemaVersion: 1,
          query: input.query,
          mode: input.mode ?? "ask",
          breadth: input.breadth ?? "balanced",
          status: "empty",
          items: [],
          dropped: [],
          warnings: [],
          budget: {
            maximumTokens: 1_000,
            usedTokens: 0,
            remainingTokens: 1_000,
            maximumItems: 10,
            maximumFiles: 10,
            maximumItemsPerFile: 2,
          },
          statistics: {
            retrievedCandidates: 0,
            synthesizedReferences: 0,
            consideredCandidates: 0,
            selectedItems: 0,
            droppedItems: 0,
            selectedFiles: 0,
            selectedRoots: 0,
            requiredItems: 0,
            preferredItems: 0,
            supplementaryItems: 0,
            fullFileItems: 0,
            exactRangeItems: 0,
            targetedExcerptItems: 0,
            fileOutlineItems: 0,
            symbolSignatureItems: 0,
          },
        }) as ReturnType<
          RepositoryContextPipelineDependencies["selector"]["select"]
        >,
    },
    assembler: {
      assemble: async (input) => ({
        schemaVersion: 1,
        workspaceSnapshotId: input.snapshot.snapshotId,
        selectionStatus: input.selection.status,
        status: "complete",
        blocks: [
          {
            id: "block_auth",
            trust: "untrusted_repository_content",
            sourceId: "wired",
            relativePath: "src/auth.ts",
            requestedRepresentation: "targeted_excerpt",
            representation: "targeted_excerpt",
            content: "export function login() {\n  return true;\n}",
            lineRanges: [{ startLine: 1, endLine: 3 }],
            allocatedTokens: 20,
            tokenEstimate: 20,
            truncated: false,
            omittedCharacters: 0,
            redactions: [],
            provenance: {
              selectionKey: "auth",
              selectionOrder: 0,
              origins: ["explicit_file"],
              priority: "preferred",
              score: 1,
              signals: [],
              retrievalSourceIds: [],
            },
          },
        ],
        dropped: [],
        warnings: [],
        budget: {
          allocatedTokens: 20,
          usedTokens: 20,
          remainingTokens: 0,
        },
        statistics: {
          selectedItems: 1,
          attemptedItems: 1,
          assembledBlocks: 1,
          droppedBlocks: 0,
          loadedFiles: 1,
          loadedRoots: 0,
          truncatedBlocks: 0,
          fallbackBlocks: 0,
          redactedBlocks: 0,
          redactionCount: 0,
          inputCharacters: 40,
          outputCharacters: 40,
        },
      }),
    },
  };
}
