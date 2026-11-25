import type {
  ChangeImpactParsedInput,
  ChangeImpactReasonCode,
  ChangeImpactWarningCode,
} from "../types";
import type {
  RepoGraphEdge,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
} from "../../repository-state";
import { expandSymbolRollup } from "./expandSymbolRollup";
import {
  coversLine,
  normalizeRelativePath,
  selectExportSeeds,
  symbolSpan,
} from "./impactGraphHelpers";
import type {
  RepoGraphProjectNode,
  ResolvedSeedNode,
  SeedExpansion,
} from "./impactTypes";
import { resolvePathIdentity } from "./resolvePathIdentity";
import { resolveSoftSymbolMatches } from "./resolveSoftSymbolMatches";

export function resolveSeedNodes(params: {
  input: ChangeImpactParsedInput;
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
  projectByProjectId: ReadonlyMap<string, RepoGraphProjectNode>;
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
  reasonCodes: Set<ChangeImpactReasonCode>;
}): ResolvedSeedNode[] {
  const seed = params.input.seed;
  const identity = resolvePathIdentity({
    relativePath: seed.relativePath,
    overlays: params.input.pathIdentityOverlays,
  });

  let file: RepoGraphFileNode | undefined;
  for (const candidate of identity.candidatePaths) {
    file = findFile(params.fileByFileId, candidate, seed.rootId);
    if (file) break;
  }
  if (!file) return [];

  if (identity.remapped) {
    params.reasonCodes.add("path_identity_remapped");
    params.warnings.push({
      code: "path_identity_remapped",
      message:
        "Seed path was remapped through a host path-identity overlay (rename/delete).",
    });
  }

  let seeds: ResolvedSeedNode[];
  if (seed.kind === "file") {
    seeds = expandFileSeed({
      file,
      input: params.input,
      nodeById: params.nodeById,
      projectByProjectId: params.projectByProjectId,
      graphEdges: params.input.repoGraph.edges,
    });
  } else {
    seeds = resolveSymbolOrCaretSeed({
      seed,
      file,
      input: params.input,
      nodeById: params.nodeById,
      projectByProjectId: params.projectByProjectId,
      warnings: params.warnings,
      reasonCodes: params.reasonCodes,
    });
  }

  const rollup = expandSymbolRollup({
    seeds,
    nodeById: params.nodeById,
  });
  seeds = rollup.seeds;
  if (rollup.expanded) {
    params.reasonCodes.add("seed_rollup_expanded");
    params.warnings.push({
      code: "seed_rollup_expanded",
      message:
        "Seed symbols expanded to related parent/child symbols via published nesting.",
    });
  }

  for (const priorPath of identity.retainedPriorPaths) {
    const priorFile = findFile(
      params.fileByFileId,
      priorPath,
      seed.rootId,
    );
    if (!priorFile || seeds.some((entry) => entry.node.id === priorFile.id)) {
      continue;
    }
    seeds.push(...expandFileSeed({
      file: priorFile,
      input: params.input,
      nodeById: params.nodeById,
      projectByProjectId: params.projectByProjectId,
      graphEdges: params.input.repoGraph.edges,
    }));
  }

  return dedupeSeeds(seeds);
}

function resolveSymbolOrCaretSeed(params: {
  seed: Extract<ChangeImpactParsedInput["seed"], { kind: "symbol" | "caret" }>;
  file: RepoGraphFileNode;
  input: ChangeImpactParsedInput;
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  projectByProjectId: ReadonlyMap<string, RepoGraphProjectNode>;
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
  reasonCodes: Set<ChangeImpactReasonCode>;
}): ResolvedSeedNode[] {
  const { seed, file } = params;
  const symbols = [...params.nodeById.values()].filter(
    (node): node is RepoGraphSymbolNode =>
      node.kind === "symbol" &&
      node.fileId === file.fileId &&
      (seed.kind === "caret"
        ? symbolMatchesCaret(node, seed.line, seed.symbolName)
        : node.name === seed.symbolName) &&
      (seed.kind !== "symbol" ||
        seed.startLine === undefined ||
        node.startLine === seed.startLine),
  );

  const selected =
    seed.kind === "caret"
      ? symbols
          .sort((left, right) => {
            const startDelta =
              (right.startLine ?? 1) - (left.startLine ?? 1);
            if (startDelta !== 0) return startDelta;
            return symbolSpan(left) - symbolSpan(right);
          })
          .slice(0, 1)
      : symbols;

  if (selected.length > 1) {
    params.reasonCodes.add("seed_ambiguous");
  }

  let resolved = selected;
  if (resolved.length === 0) {
    const symbolsInFile = [...params.nodeById.values()].filter(
      (node): node is RepoGraphSymbolNode =>
        node.kind === "symbol" && node.fileId === file.fileId,
    );
    const soft = resolveSoftSymbolMatches({
      symbolsInFile,
      symbolName: seed.symbolName,
      line: seed.kind === "caret" ? seed.line : undefined,
      textOccurrenceLines: (params.input.textOccurrenceHints ?? [])
        .filter((hint) => {
          if (!hint.symbolName) return true;
          return !seed.symbolName || hint.symbolName === seed.symbolName;
        })
        .map((hint) => hint.line),
    });
    if (soft.length > 0) {
      resolved = soft;
      params.reasonCodes.add("seed_soft_resolved");
      params.warnings.push({
        code: "seed_soft_matched",
        message:
          "Seed symbol matched via soft name/occurrence fallback before file-level expand.",
      });
    }
  }

  if (resolved.length === 0) {
    params.warnings.push({
      code: "seed_file_only",
      message:
        "Seed symbol was not resolved; falling back to file-level impact.",
    });
    return expandFileSeed({
      file,
      input: params.input,
      nodeById: params.nodeById,
      projectByProjectId: params.projectByProjectId,
      graphEdges: params.input.repoGraph.edges,
    });
  }

  const seeds: ResolvedSeedNode[] = resolved.map((node) => ({ node, file }));
  const project = file.projectId
    ? params.projectByProjectId.get(file.projectId)
    : undefined;
  if (params.input.includePackages && project) {
    seeds.push({ node: project });
  }
  return seeds;
}

function expandFileSeed(params: {
  file: RepoGraphFileNode;
  input: ChangeImpactParsedInput;
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  projectByProjectId: ReadonlyMap<string, RepoGraphProjectNode>;
  graphEdges: readonly RepoGraphEdge[];
}): ResolvedSeedNode[] {
  const seeds: ResolvedSeedNode[] = [{ node: params.file, file: params.file }];
  const symbolsInFile = [...params.nodeById.values()].filter(
    (node): node is RepoGraphSymbolNode =>
      node.kind === "symbol" && node.fileId === params.file.fileId,
  );

  const expansion: SeedExpansion = params.input.seedExpansion;
  if (expansion === "file_all_symbols") {
    for (const node of symbolsInFile) {
      seeds.push({ node, file: params.file });
    }
  } else if (expansion === "file_exports") {
    for (const node of selectExportSeeds({
      symbolsInFile,
      fileNodeId: params.file.id,
      edges: params.graphEdges,
    })) {
      seeds.push({ node, file: params.file });
    }
  }

  const project = params.file.projectId
    ? params.projectByProjectId.get(params.file.projectId)
    : undefined;
  if (params.input.includePackages && project) {
    seeds.push({ node: project });
  }
  return seeds;
}

function dedupeSeeds(seeds: readonly ResolvedSeedNode[]): ResolvedSeedNode[] {
  const seen = new Set<string>();
  const result: ResolvedSeedNode[] = [];
  for (const seed of seeds) {
    if (seen.has(seed.node.id)) continue;
    seen.add(seed.node.id);
    result.push(seed);
  }
  return result;
}

function findFile(
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>,
  relativePath: string,
  rootId?: string,
): RepoGraphFileNode | undefined {
  const normalized = normalizeRelativePath(relativePath);
  return [...fileByFileId.values()].find(
    (file) =>
      normalizeRelativePath(file.relativePath) === normalized &&
      (!rootId || file.rootId === rootId),
  );
}

function symbolMatchesCaret(
  node: RepoGraphSymbolNode,
  line: number,
  symbolName?: string,
): boolean {
  if (symbolName && node.name !== symbolName) {
    return false;
  }
  return coversLine(node, line);
}
