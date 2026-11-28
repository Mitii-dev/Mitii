import { describe, expect, it } from "vitest";

import type {
  RepositoryStateDescriptor,
  RepositoryStateReference,
  WorkspaceSnapshot,
} from "../../repository-state/index";

import type {
  ContextAssemblyInput,
  ContextAssemblyResult,
} from "../helpers/context-assembly/types";

import type {
  ContextSelectionInput,
  ContextSelectionResult,
} from "../helpers/context-selection/types";

import type {
  HybridRetrievalInput,
  HybridRetrievalResult,
} from "../helpers/hybrid-retrieval/types";

import {
  RepositoryContextPipeline,
  repositoryContextPipelineInputSchema,
} from "../index";

import type {
  RepositoryContextResolvedState,
  RepositoryContextStateResolveResult,
  RepositoryContextStateResolverPort,
} from "../contracts/types";

const SNAPSHOT_ID = "a".repeat(64);
const STATE_TOKEN = "b".repeat(64);

const snapshot: WorkspaceSnapshot = {
  schemaVersion: 1,
  snapshotId: SNAPSHOT_ID,
  roots: [
    {
      id: "root",
      name: "root",
      kind: "directory",
    },
  ],
  entries: [],
  warnings: [],
  statistics: {
    files: 0,
    directories: 0,
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
  generatedAt: "2026-07-25T12:00:00.000Z",
};

const descriptor = (
  readiness: RepositoryStateDescriptor["readiness"] = "ready",
): RepositoryStateDescriptor => ({
  schemaVersion: 1,
  workspaceId: "workspace",
  stateToken: STATE_TOKEN,
  snapshotId: SNAPSHOT_ID,
  roots: [
    {
      rootId: "root",
      projectCatalogRevision: "catalog-1",
      codeIndexRevision: "index-1",
      textIndexRevision: "text-1",
      capabilities: [
        { capability: "catalog", status: "available" },
        { capability: "codeIndex", status: "available" },
        { capability: "textIndex", status: "available" },
      ],
    },
  ],
  readiness,
  reasons:
    readiness === "ready"
      ? []
      : [
          {
            code: "scan_partial",
            message: "Partial scan",
          },
        ],
  generatedAt: "2026-07-25T12:00:00.000Z",
  scanCompleteness: readiness === "ready" ? "complete" : "partial",
  cleanupAllowed: readiness === "ready",
});

const resolvedArtifacts = (
  readiness: RepositoryStateDescriptor["readiness"] = "ready",
): RepositoryContextResolvedState => ({
  descriptor: descriptor(readiness),
  snapshot,
});

const createResolver = (
  resolve: (
    reference: RepositoryStateReference,
  ) => Promise<RepositoryContextStateResolveResult> | RepositoryContextStateResolveResult,
): RepositoryContextStateResolverPort => ({
  resolve: async (reference) => resolve(reference),
});

const emptyRetrieval = (query: string): HybridRetrievalResult => ({
  schemaVersion: 1,
  query,
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
});

const emptySelection = (
  input: ContextSelectionInput,
): ContextSelectionResult => ({
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
});

const emptyAssembly = (
  input: ContextAssemblyInput,
): ContextAssemblyResult => ({
  schemaVersion: 1,
  workspaceSnapshotId: input.snapshot.snapshotId,
  selectionStatus: input.selection.status,
  status: "empty",
  blocks: [],
  dropped: [],
  warnings: [],
  budget: {
    allocatedTokens: 0,
    usedTokens: 0,
    remainingTokens: 0,
  },
  statistics: {
    selectedItems: 0,
    attemptedItems: 0,
    assembledBlocks: 0,
    droppedBlocks: 0,
    loadedFiles: 0,
    loadedRoots: 0,
    truncatedBlocks: 0,
    fallbackBlocks: 0,
    redactedBlocks: 0,
    redactionCount: 0,
    inputCharacters: 0,
    outputCharacters: 0,
  },
});

describe("RepositoryContextPipeline", () => {
it("pipeline resolves state then runs retrieval, selection, and assembly", async () => {
  const calls: string[] = [];
  let retrievalInput: HybridRetrievalInput | undefined;

  const pipeline = new RepositoryContextPipeline({
    stateResolver: createResolver((reference) => {
      expect(reference.stateToken).toBe(STATE_TOKEN);
      return {
        status: "resolved",
        artifacts: resolvedArtifacts(),
      };
    }),
    retriever: {
      retrieve: async (input) => {
        calls.push("retrieval");
        retrievalInput = input;
        return emptyRetrieval(input.query);
      },
    },
    selector: {
      select: (input) => {
        calls.push("selection");
        return emptySelection(input);
      },
    },
    assembler: {
      assemble: async (input) => {
        calls.push("assembly");
        return emptyAssembly(input);
      },
    },
  });

  const result = await pipeline.execute({
    state: {
      workspaceId: "workspace",
      stateToken: STATE_TOKEN,
    },
    query: "Find authentication code",
    mode: "plan",
    rootIds: ["root"],
  });

  expect(calls).toEqual(["retrieval", "selection", "assembly"]);
  expect(retrievalInput?.workspaceSnapshotId).toBe(SNAPSHOT_ID);
  expect(retrievalInput?.codeIndexChangeToken).toBe("index-1");
  expect(retrievalInput?.workspace).toBe("workspace");
  expect(result.stateToken).toBe(STATE_TOKEN);
  expect(result.workspaceSnapshotId).toBe(SNAPSHOT_ID);
  expect(result.status).toBe("empty");
});

it("public input accepts only a state reference, not loose snapshot artifacts", () => {
  const valid = repositoryContextPipelineInputSchema.safeParse({
    state: {
      workspaceId: "workspace",
      stateToken: STATE_TOKEN,
    },
    query: "Find authentication code",
    mode: "ask",
  });
  expect(valid.success).toBe(true);

  const withSnapshot = repositoryContextPipelineInputSchema.safeParse({
    state: {
      workspaceId: "workspace",
      stateToken: STATE_TOKEN,
    },
    query: "Find authentication code",
    mode: "ask",
    snapshot,
  });
  expect(withSnapshot.success).toBe(false);

  const withRepoMap = repositoryContextPipelineInputSchema.safeParse({
    state: {
      workspaceId: "workspace",
      stateToken: STATE_TOKEN,
    },
    query: "Find authentication code",
    mode: "ask",
    repoMap: {
      schemaVersion: 1,
      workspaceSnapshotId: SNAPSHOT_ID,
      codeIndexChangeToken: "index-1",
      entries: [],
      statistics: {
        availableFiles: 0,
        rankedFiles: 0,
        includedFiles: 0,
        includedSymbols: 0,
        estimatedTokens: 0,
        durationMs: 0,
      },
      status: "complete",
      generatedAt: "2026-07-25T12:00:00.000Z",
    },
  });
  expect(withRepoMap.success).toBe(false);
});

it("unknown state token fails closed without retrieval", async () => {
  let retrieved = false;

  const pipeline = new RepositoryContextPipeline({
    stateResolver: createResolver(() => ({
      status: "not_found",
      code: "unknown_state_token",
      message: "missing",
    })),
    retriever: {
      retrieve: async (input) => {
        retrieved = true;
        return emptyRetrieval(input.query);
      },
    },
    selector: {
      select: emptySelection,
    },
    assembler: {
      assemble: emptyAssembly,
    },
  });

  const result = await pipeline.execute({
    state: {
      workspaceId: "workspace",
      stateToken: "missing-token",
    },
    query: "Find authentication code",
    mode: "ask",
  });

  expect(retrieved).toBe(false);
  expect(result.status).toBe("failed");
  expect(result.warnings[0]?.code).toBe("unknown_state_token");
  expect(result.warnings[0]?.stage).toBe("state_resolution");
});

it("unavailable state fails closed; degraded state warns and continues", async () => {
  const unavailablePipeline = new RepositoryContextPipeline({
    stateResolver: createResolver(() => ({
      status: "resolved",
      artifacts: resolvedArtifacts("unavailable"),
    })),
    retriever: {
      retrieve: async (input) => emptyRetrieval(input.query),
    },
    selector: {
      select: emptySelection,
    },
    assembler: {
      assemble: emptyAssembly,
    },
  });

  const unavailable = await unavailablePipeline.execute({
    state: {
      workspaceId: "workspace",
      stateToken: STATE_TOKEN,
    },
    query: "Find authentication code",
    mode: "ask",
  });
  expect(unavailable.status).toBe("failed");
  expect(unavailable.warnings[0]?.code).toBe("state_unavailable");

  let retrieved = false;
  const degradedPipeline = new RepositoryContextPipeline({
    stateResolver: createResolver(() => ({
      status: "resolved",
      artifacts: resolvedArtifacts("degraded"),
    })),
    retriever: {
      retrieve: async (input) => {
        retrieved = true;
        return emptyRetrieval(input.query);
      },
    },
    selector: {
      select: emptySelection,
    },
    assembler: {
      assemble: emptyAssembly,
    },
  });

  const degraded = await degradedPipeline.execute({
    state: {
      workspaceId: "workspace",
      stateToken: STATE_TOKEN,
    },
    query: "Find authentication code",
    mode: "ask",
  });

  expect(retrieved).toBe(true);
  expect(degraded.status).toBe("empty");
  expect(
    degraded.warnings.some((warning) => warning.code === "state_degraded"),
  ).toBe(true);
});

it("folderPrefix drops unrelated git and editor references before selection", async () => {
  let selectionInput: ContextSelectionInput | undefined;

  const pipeline = new RepositoryContextPipeline({
    stateResolver: createResolver(() => ({
      status: "resolved",
      artifacts: resolvedArtifacts(),
    })),
    retriever: {
      retrieve: async (input) => emptyRetrieval(input.query),
    },
    selector: {
      select: (input) => {
        selectionInput = input;
        return emptySelection(input);
      },
    },
    assembler: {
      assemble: emptyAssembly,
    },
  });

  await pipeline.execute({
    state: {
      workspaceId: "workspace",
      stateToken: STATE_TOKEN,
    },
    query: "fix types in this package",
    mode: "agent",
    folderPrefix: "packages/demo",
    references: {
      gitDiffFiles: [
        { relativePath: ".gitignore" },
        { relativePath: "packages/demo/src/used.ts" },
      ],
      openFiles: [{ relativePath: "apps/docs/readme.md" }],
    },
  });

  expect(
    selectionInput?.references?.gitDiffFiles?.map((file) => file.relativePath),
  ).toEqual(["packages/demo/src/used.ts"]);
  expect(selectionInput?.references?.openFiles).toBe(undefined);
});
});

