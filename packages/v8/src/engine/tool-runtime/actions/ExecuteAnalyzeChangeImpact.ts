import {
  CHANGE_IMPACT_SCHEMA_VERSION,
  ChangeImpactPipeline,
  changeImpactResultSchema,
  compactChangeImpactForModelFacing,
  mergeNavigationEnrichment,
  type ChangeImpactInput,
  type ChangeImpactResult,
} from "../../../modules/change-impact";
import type { CodeNavigationPort } from "../../../modules/code-navigation";
import type { RepoGraph } from "../../../modules/repository-state";
import type {
  RepositoryGraphPort,
  WorkspaceFileSystemPort,
} from "../contracts";
import { ToolRuntimeError } from "../contracts";
import {
  analyzeChangeImpactInputSchema,
  analyzeChangeImpactOutputSchema,
} from "../internal/ToolCatalog";

export async function executeAnalyzeChangeImpact(params: {
  arguments: unknown;
  repoGraphs?: RepositoryGraphPort;
  codeNavigation?: CodeNavigationPort;
  fileSystem?: WorkspaceFileSystemPort;
  workspaceRoot?: string;
  /** Host/intake dirty paths for this run (pre-existing uncommitted edits). */
  dirtyPaths?: readonly string[];
  /** Paths already mutated earlier in this run. */
  alreadyMutatedPaths?: readonly string[];
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = analyzeChangeImpactInputSchema.parse(params.arguments);

  if (!params.repoGraphs) {
    return unavailableOutput(input.path);
  }

  const graphs = await params.repoGraphs.loadGraphs();
  if (graphs.length === 0) {
    return unavailableOutput(input.path);
  }

  const graph = selectGraph(graphs, input.path) ?? graphs[0];
  if (!graph) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      "Repository graph port returned no graph.",
    );
  }

  const workspaceDirtyDuringRun =
    (params.dirtyPaths?.length ?? 0) > 0 ||
    (params.alreadyMutatedPaths?.length ?? 0) > 0;

  let expectedCodeIndexChangeToken =
    params.repoGraphs.expectedCodeIndexChangeToken
      ? await params.repoGraphs.expectedCodeIndexChangeToken(graph)
      : undefined;

  // In-run edits invalidate the published graph even when the host watermark
  // has not been refreshed yet.
  if (workspaceDirtyDuringRun) {
    const base =
      expectedCodeIndexChangeToken ?? graph.codeIndexChangeToken ?? "run";
    if (base === graph.codeIndexChangeToken) {
      expectedCodeIndexChangeToken = `${base}:run-dirty`;
    }
  }

  const importanceByRelativePath = await loadImportanceRecord(
    params.repoGraphs,
  );
  const textOccurrenceHints = await collectTextOccurrenceHints({
    path: input.path,
    symbolName: input.symbolName,
    fileSystem: params.fileSystem,
    workspaceRoot: params.workspaceRoot,
  });

  let result = new ChangeImpactPipeline().analyze({
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    seed: toSeed(input),
    repoGraph: graph,
    ...(expectedCodeIndexChangeToken
      ? { codeIndexChangeToken: expectedCodeIndexChangeToken }
      : {}),
    ...(input.edgeTypes ? { edgeTypes: input.edgeTypes } : {}),
    ...(input.maximumHops ? { maximumHops: input.maximumHops } : {}),
    ...(input.maximumAffectedNodes
      ? { maximumAffectedNodes: input.maximumAffectedNodes }
      : {}),
    ...(input.maximumPaths ? { maximumPaths: input.maximumPaths } : {}),
    ...(typeof input.includePackages === "boolean"
      ? { includePackages: input.includePackages }
      : {}),
    ...(input.seedExpansion ? { seedExpansion: input.seedExpansion } : {}),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(importanceByRelativePath
      ? { importanceByRelativePath }
      : {}),
    ...(textOccurrenceHints.length > 0
      ? { textOccurrenceHints }
      : {}),
  } satisfies ChangeImpactInput);

  result = await maybeEnrichFromCodeNavigation({
    result,
    input,
    codeNavigation: params.codeNavigation,
  });

  const parsed = changeImpactResultSchema.parse(result);
  const slim = compactChangeImpactForModelFacing({
    affected: parsed.affected.map((node) => ({
      path: node.relativePath,
      ...(node.symbolName ? { symbolName: node.symbolName } : {}),
      ...(node.symbolKind ? { symbolKind: node.symbolKind } : {}),
      hop: node.hop,
      viaEdgeType: node.viaEdgeType,
      score: node.score,
      evidence: node.evidence,
    })),
    affectedFiles: parsed.affectedFiles.map((file) => ({
      path: file.relativePath,
      hop: file.hop,
      score: file.score,
      affectedNodeCount: file.affectedNodeIds.length,
      reason: file.reason,
      bucket: file.bucket,
    })),
    packagesAffected: parsed.packagesAffected.map((project) => ({
      name: project.name,
      projectId: project.projectId,
      hop: project.hop,
      ...(project.viaEdgeType ? { viaEdgeType: project.viaEdgeType } : {}),
    })),
    chains: parsed.chains.map((chain) => ({
      links: chain.links.map((link) => ({
        ...(link.relativePath ? { path: link.relativePath } : {}),
        ...(link.symbolName ? { symbolName: link.symbolName } : {}),
        nodeId: link.nodeId,
      })),
      hop: chain.hop,
      score: chain.score,
      ...(chain.viaEdgeType ? { viaEdgeType: chain.viaEdgeType } : {}),
    })),
  });

  const output = analyzeChangeImpactOutputSchema.parse({
    path: input.path,
    provider: "repo_graph",
    status: parsed.status,
    resolvedSeeds: parsed.resolvedSeeds.map((seed) => ({
      kind: seed.kind,
      ...(seed.relativePath ? { path: seed.relativePath } : {}),
      ...(seed.symbolName ? { symbolName: seed.symbolName } : {}),
      ...(seed.symbolKind ? { symbolKind: seed.symbolKind } : {}),
    })),
    affected: slim.affected,
    affectedFiles: slim.affectedFiles,
    packagesAffected: slim.packagesAffected,
    chains: slim.chains,
    directNeighborCounts: parsed.directNeighborCounts,
    // Reflect graph walk + intentional model-facing caps in the payload;
    // do not mark the ToolResult itself truncated (that surfaces as
    // output_truncated and looks like a failed/cut tool call).
    truncated: parsed.truncated || slim.modelFacingTruncated,
    warnings: [
      ...parsed.warnings,
      ...(slim.modelFacingTruncated
        ? [
            {
              code: "model_facing_truncated",
              message: `Affected nodes/files/chains capped for tool-result budget (kept ${slim.affected.length} nodes, ${slim.affectedFiles.length} files, ${slim.chains.length} chain lines of ${slim.totalAffectedNodes}/${slim.totalAffectedFiles}/${slim.totalChains}).`,
            },
          ]
        : []),
    ],
    reasonCodes: [
      ...parsed.reasonCodes,
      ...(slim.modelFacingTruncated ? ["model_facing_truncated"] : []),
    ],
    graphRevision: parsed.graphRevision,
    codeIndexChangeToken: parsed.codeIndexChangeToken,
  });

  return {
    output,
    truncated: false,
    redacted: false,
  };
}

async function loadImportanceRecord(
  repoGraphs: RepositoryGraphPort,
): Promise<Record<string, number> | undefined> {
  if (!repoGraphs.loadImportanceByRelativePath) return undefined;
  const loaded = await repoGraphs.loadImportanceByRelativePath();
  if (!loaded) return undefined;
  // ReadonlyMap is an interface — instanceof Map alone does not narrow it away
  // for the Record spread below.
  if (isStringNumberMap(loaded)) {
    return Object.fromEntries(loaded.entries());
  }
  return { ...(loaded as Readonly<Record<string, number>>) };
}

function isStringNumberMap(
  value: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
): value is ReadonlyMap<string, number> {
  return (
    typeof (value as ReadonlyMap<string, number>).entries === "function" &&
    typeof (value as ReadonlyMap<string, number>).get === "function" &&
    typeof (value as ReadonlyMap<string, number>).forEach === "function"
  );
}

async function collectTextOccurrenceHints(params: {
  path: string;
  symbolName?: string;
  fileSystem?: WorkspaceFileSystemPort;
  workspaceRoot?: string;
}): Promise<Array<{ line: number; symbolName?: string }>> {
  if (!params.symbolName || !params.fileSystem || !params.workspaceRoot) {
    return [];
  }
  try {
    const absolute = params.fileSystem.resolve(
      params.workspaceRoot,
      params.path,
    );
    const read = await params.fileSystem.readFile(absolute, {
      maxBytes: 256_000,
    });
    const hints: Array<{ line: number; symbolName?: string }> = [];
    const lines = read.content.split(/\r?\n/);
    const needle = params.symbolName;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!line.includes(needle)) continue;
      // Prefer identifier-ish hits over comments-only noise.
      if (!new RegExp(`\\b${escapeRegExp(needle)}\\b`).test(line)) continue;
      hints.push({ line: index + 1, symbolName: needle });
      if (hints.length >= 20) break;
    }
    return hints;
  } catch {
    return [];
  }
}

async function maybeEnrichFromCodeNavigation(params: {
  result: ChangeImpactResult;
  input: {
    path: string;
    line?: number;
    column?: number;
    symbolName?: string;
    direction?: "dependents" | "dependencies";
  };
  codeNavigation?: CodeNavigationPort;
}): Promise<ChangeImpactResult> {
  if (!params.codeNavigation) return params.result;
  if (!shouldEnrichFromCodeNavigation(params.result)) {
    return params.result;
  }

  // LSP needs a caret. Prefer explicit line; else a resolved symbol's startLine.
  const queryLine =
    params.input.line ??
    params.result.resolvedSeeds.find(
      (seed) => seed.kind === "symbol" && typeof seed.startLine === "number",
    )?.startLine;
  if (queryLine === undefined) {
    return params.result;
  }

  const direction = params.input.direction ?? params.result.direction;
  const query = {
    relativePath: params.input.path,
    line: queryLine,
    column: params.input.column ?? 1,
    ...(params.input.symbolName
      ? { symbolName: params.input.symbolName }
      : {}),
  };

  try {
    const locations =
      direction === "dependencies" && params.codeNavigation.callHierarchy
        ? await params.codeNavigation.callHierarchy({
            ...query,
            direction: "outgoing",
          })
        : await params.codeNavigation.references(query);

    return mergeNavigationEnrichment({
      result: params.result,
      locations: locations.map((location) => ({
        relativePath: location.relativePath,
        line: location.startLine,
        ...(location.symbolName ? { symbolName: location.symbolName } : {}),
      })),
      viaEdgeType: direction === "dependencies" ? "calls" : "references",
    });
  } catch {
    return params.result;
  }
}

function shouldEnrichFromCodeNavigation(result: ChangeImpactResult): boolean {
  if (result.status === "unavailable") return false;
  if (result.reasonCodes.includes("seed_unresolved")) return false;
  if (
    result.affectedFiles.length === 0 ||
    result.reasonCodes.includes("no_dependents") ||
    result.reasonCodes.includes("no_dependencies") ||
    result.warnings.some((warning) => warning.code === "graph_partial") ||
    result.warnings.some((warning) => warning.code === "seed_file_only")
  ) {
    return true;
  }
  return false;
}

function toSeed(input: {
  path: string;
  line?: number;
  column?: number;
  symbolName?: string;
}): ChangeImpactInput["seed"] {
  if (input.line !== undefined) {
    return {
      kind: "caret",
      relativePath: input.path,
      line: input.line,
      column: input.column ?? 1,
      ...(input.symbolName ? { symbolName: input.symbolName } : {}),
    };
  }
  if (input.symbolName) {
    return {
      kind: "symbol",
      relativePath: input.path,
      symbolName: input.symbolName,
    };
  }
  return {
    kind: "file",
    relativePath: input.path,
  };
}

function selectGraph(
  graphs: readonly RepoGraph[],
  path: string,
): RepoGraph | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return graphs.find((graph) =>
    graph.nodes.some(
      (node) =>
        node.kind === "file" &&
        node.relativePath.replace(/\\/g, "/").replace(/^\.\//, "") ===
          normalized,
    ),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unavailableOutput(
  path: string,
): { output: unknown; truncated: boolean; redacted: boolean } {
  return {
    output: analyzeChangeImpactOutputSchema.parse({
      path,
      provider: "repo_graph",
      status: "unavailable",
      resolvedSeeds: [],
      affected: [],
      affectedFiles: [],
      packagesAffected: [],
      chains: [],
      directNeighborCounts: { nodes: 0, files: 0 },
      truncated: false,
      warnings: [],
      reasonCodes: ["graph_unavailable"],
    }),
    truncated: false,
    redacted: false,
  };
}
