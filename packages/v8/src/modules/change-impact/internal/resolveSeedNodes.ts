import type {
  ChangeImpactParsedInput,
  ChangeImpactReasonCode,
  ChangeImpactWarningCode,
} from "../contracts";
import type {
  RepoGraphEdge,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
} from "../../repository-state";
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
  const file = findFile(params.fileByFileId, seed.relativePath, seed.rootId);
  if (!file) return [];

  if (seed.kind === "file") {
    return expandFileSeed({
      file,
      input: params.input,
      nodeById: params.nodeById,
      projectByProjectId: params.projectByProjectId,
      graphEdges: params.input.repoGraph.edges,
    });
  }

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
            // Prefer nearest enclosing: largest startLine among covers, then
            // smallest span (Goose-style disambiguation + nested symbols).
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
      symbolName:
        seed.kind === "symbol" || seed.kind === "caret"
          ? seed.symbolName
          : undefined,
      line: seed.kind === "caret" ? seed.line : undefined,
      textOccurrenceLines: (params.input.textOccurrenceHints ?? [])
        .filter((hint) => {
          if (!hint.symbolName) return true;
          const seedName =
            seed.kind === "symbol" || seed.kind === "caret"
              ? seed.symbolName
              : undefined;
          return !seedName || hint.symbolName === seedName;
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
