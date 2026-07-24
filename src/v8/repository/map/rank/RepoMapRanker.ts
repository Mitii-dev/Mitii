import {
  REPO_MAP_DEFAULTS,
  REPO_MAP_PATTERNS,
  REPO_MAP_SCORE_WEIGHTS,
  REPO_MAP_SYMBOL_KIND_PRIORITY,
} from "../constants";

import { throwIfRepoMapAborted } from "../data-source";

import type { ProjectCatalog, ProjectDefinition } from "../../catalog";

import type {
  RepoMapDataSource,
  RepoMapDataSourceContext,
  RepoMapEntry,
  RepoMapFile,
  RepoMapFileSelection,
  RepoMapImport,
  RepoMapRankerOptions,
  RepoMapRankingInput,
  RepoMapRankingResult,
  RepoMapReference,
  RepoMapScoreReason,
  RepoMapScoreReasonType,
  RepoMapSymbol,
} from "../types";

import { computePageRank } from "./pageRank";

export class RepoMapRanker {
  private readonly maximumFiles: number;
  private readonly symbolBatchSize: number;
  private readonly graphBatchSize: number;
  private readonly maximumSymbolsPerFile: number;
  private readonly pageRankIterations: number;
  private readonly pageRankDamping: number;

  constructor(
    private readonly dataSource: RepoMapDataSource,
    options: RepoMapRankerOptions = {},
  ) {
    this.maximumFiles = options.maximumFiles ?? REPO_MAP_DEFAULTS.MAXIMUM_FILES;

    this.symbolBatchSize =
      options.symbolBatchSize ?? REPO_MAP_DEFAULTS.SYMBOL_BATCH_SIZE;

    this.graphBatchSize =
      options.graphBatchSize ?? REPO_MAP_DEFAULTS.GRAPH_BATCH_SIZE;

    this.maximumSymbolsPerFile =
      options.maximumSymbolsPerFile ??
      REPO_MAP_DEFAULTS.MAXIMUM_SYMBOLS_PER_FILE;

    this.pageRankIterations =
      options.pageRankIterations ?? REPO_MAP_DEFAULTS.PAGE_RANK_ITERATIONS;

    this.pageRankDamping =
      options.pageRankDamping ?? REPO_MAP_DEFAULTS.PAGE_RANK_DAMPING;

    this.validateOptions();
  }

  public async rank(input: RepoMapRankingInput): Promise<RepoMapRankingResult> {
    throwIfRepoMapAborted(input.abortSignal);

    this.validateSnapshotCatalog(input);

    const dataSourceContext: RepoMapDataSourceContext = {
      snapshot: input.snapshot,

      ...(input.abortSignal
        ? {
            abortSignal: input.abortSignal,
          }
        : {}),
    };

    const fileResult = await this.dataSource.getFiles(
      {
        rootIds: input.context.rootIds,

        folderPrefix: input.context.folderPrefix,

        maximumFiles: this.maximumFiles,
      },
      dataSourceContext,
    );

    if (fileResult.files.length > this.maximumFiles) {
      throw new Error(
        `Repo Map data source "${this.dataSource.id}" returned ` +
          `${fileResult.files.length} files, exceeding maximumFiles ` +
          `of ${this.maximumFiles}.`,
      );
    }

    let files = this.enforceSnapshotMembership(
      fileResult.files,
      input.snapshot,
    );

    files = this.attachProjectIds(files, input.catalog);

    files.sort((left, right) => {
      const rootComparison = left.rootId.localeCompare(right.rootId);

      if (rootComparison !== 0) {
        return rootComparison;
      }

      return left.relativePath.localeCompare(right.relativePath);
    });

    throwIfRepoMapAborted(input.abortSignal);

    const fileIds = files.map((file) => file.id);

    const [symbolsByFile, imports, references] = await Promise.all([
      this.loadSymbolsInBatches(fileIds, dataSourceContext),

      this.loadImportsInBatches(fileIds, dataSourceContext),

      this.loadReferencesInBatches(fileIds, dataSourceContext),
    ]);

    throwIfRepoMapAborted(input.abortSignal);

    const fileIdSet = new Set(fileIds);

    const validImports = imports.filter(
      (item) =>
        fileIdSet.has(item.fromFileId) &&
        (!item.toFileId || fileIdSet.has(item.toFileId)),
    );

    const validReferences = references.filter(
      (item) =>
        fileIdSet.has(item.fromFileId) &&
        (!item.toFileId || fileIdSet.has(item.toFileId)),
    );

    const inboundImportCounts = this.countInboundImports(validImports);

    const outboundImportCounts = this.countOutboundImports(validImports);

    const referenceCounts = this.countReferences(validReferences);

    const personalization = this.buildPersonalization(files, input.context);

    const pageRank = this.computeFilePageRank(
      files,
      validImports,
      validReferences,
      personalization,
    );

    const queryTerms = this.tokenize(input.context.query);

    const entries = files
      .map((file) => {
        const symbols = this.selectSymbols(symbolsByFile.get(file.id) ?? []);

        return this.scoreFile(
          file,
          symbols,
          queryTerms,
          input.context,
          pageRank.get(file.id) ?? 0,
          inboundImportCounts.get(file.id) ?? 0,
          outboundImportCounts.get(file.id) ?? 0,
          referenceCounts.get(file.id) ?? 0,
        );
      })
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }

        const rootComparison = left.file.rootId.localeCompare(
          right.file.rootId,
        );

        if (rootComparison !== 0) {
          return rootComparison;
        }

        return left.file.relativePath.localeCompare(right.file.relativePath);
      });

    const membershipReduced = files.length < fileResult.files.length;

    return {
      files,
      entries,
      totalAvailableFiles: fileResult.totalAvailable,
      complete: !fileResult.truncated && !membershipReduced,
    };
  }

  private async loadSymbolsInBatches(
    fileIds: readonly string[],
    context: RepoMapDataSourceContext,
  ): Promise<ReadonlyMap<string, readonly RepoMapSymbol[]>> {
    const result = new Map<string, readonly RepoMapSymbol[]>();

    for (let index = 0; index < fileIds.length; index += this.symbolBatchSize) {
      throwIfRepoMapAborted(context.abortSignal);

      const batch = fileIds.slice(index, index + this.symbolBatchSize);

      const batchResult = await this.dataSource.getSymbols(batch, context);

      const requestedIds = new Set(batch);

      for (const returnedId of batchResult.keys()) {
        if (!requestedIds.has(returnedId)) {
          throw new Error(
            `Repo Map data source "${this.dataSource.id}" returned ` +
              `symbols for unrequested file ID "${returnedId}".`,
          );
        }
      }

      for (const fileId of batch) {
        result.set(fileId, batchResult.get(fileId) ?? []);
      }
    }

    return result;
  }

  private async loadImportsInBatches(
    fileIds: readonly string[],
    context: RepoMapDataSourceContext,
  ): Promise<RepoMapImport[]> {
    const result: RepoMapImport[] = [];

    for (let index = 0; index < fileIds.length; index += this.graphBatchSize) {
      throwIfRepoMapAborted(context.abortSignal);

      const batch = fileIds.slice(index, index + this.graphBatchSize);

      result.push(...(await this.dataSource.getImports(batch, context)));
    }

    return result;
  }

  private async loadReferencesInBatches(
    fileIds: readonly string[],
    context: RepoMapDataSourceContext,
  ): Promise<RepoMapReference[]> {
    const result: RepoMapReference[] = [];

    for (let index = 0; index < fileIds.length; index += this.graphBatchSize) {
      throwIfRepoMapAborted(context.abortSignal);

      const batch = fileIds.slice(index, index + this.graphBatchSize);

      result.push(...(await this.dataSource.getReferences(batch, context)));
    }

    return result;
  }

  private scoreFile(
    file: RepoMapFile,
    symbols: RepoMapSymbol[],
    queryTerms: readonly string[],
    context: RepoMapRankingInput["context"],
    pageRank: number,
    inboundImportCount: number,
    outboundImportCount: number,
    referenceCount: number,
  ): RepoMapEntry {
    const reasons: RepoMapScoreReason[] = [];

    let score = 0;

    score += this.addSelectionSignal(
      reasons,
      file,
      context.currentFile,
      "current_file",
      REPO_MAP_SCORE_WEIGHTS.CURRENT_FILE,
    );

    score += this.addSelectionListSignal(
      reasons,
      file,
      context.openFiles,
      "open_file",
      REPO_MAP_SCORE_WEIGHTS.OPEN_FILE,
    );

    score += this.addSelectionListSignal(
      reasons,
      file,
      context.gitDiffFiles,
      "git_diff",
      REPO_MAP_SCORE_WEIGHTS.GIT_DIFF_FILE,
    );

    score += this.addSelectionListSignal(
      reasons,
      file,
      context.diagnosticFiles,
      "diagnostic",
      REPO_MAP_SCORE_WEIGHTS.DIAGNOSTIC_FILE,
    );

    score += this.addSelectionListSignal(
      reasons,
      file,
      context.recentEditFiles,
      "recent_edit",
      REPO_MAP_SCORE_WEIGHTS.RECENT_EDIT_FILE,
    );

    const normalizedPath = file.relativePath.toLowerCase();

    for (const term of queryTerms) {
      if (normalizedPath.includes(term)) {
        score += REPO_MAP_SCORE_WEIGHTS.QUERY_PATH_MATCH;

        reasons.push({
          type: "query_path",

          score: REPO_MAP_SCORE_WEIGHTS.QUERY_PATH_MATCH,

          evidence: `Path matched query term "${term}".`,
        });
      }

      for (const symbol of symbols) {
        const normalizedName = symbol.name.toLowerCase();

        if (normalizedName === term) {
          score += REPO_MAP_SCORE_WEIGHTS.QUERY_SYMBOL_EXACT_MATCH;

          reasons.push({
            type: "query_symbol",

            score: REPO_MAP_SCORE_WEIGHTS.QUERY_SYMBOL_EXACT_MATCH,

            evidence: `Symbol "${symbol.name}" exactly matched query term "${term}".`,
          });

          continue;
        }

        if (normalizedName.includes(term)) {
          score += REPO_MAP_SCORE_WEIGHTS.QUERY_SYMBOL_PARTIAL_MATCH;

          reasons.push({
            type: "query_symbol",

            score: REPO_MAP_SCORE_WEIGHTS.QUERY_SYMBOL_PARTIAL_MATCH,

            evidence: `Symbol "${symbol.name}" partially matched query term "${term}".`,
          });
        }
      }
    }

    const referenceScore =
      Math.min(referenceCount, REPO_MAP_SCORE_WEIGHTS.MAXIMUM_REFERENCE_COUNT) *
      REPO_MAP_SCORE_WEIGHTS.REFERENCE_COUNT_MULTIPLIER;

    if (referenceScore > 0) {
      score += referenceScore;

      reasons.push({
        type: "reference_count",
        score: referenceScore,

        evidence: `${referenceCount} references originate from this file.`,
      });
    }

    const importScore =
      Math.min(
        inboundImportCount,
        REPO_MAP_SCORE_WEIGHTS.MAXIMUM_IMPORT_COUNT,
      ) * REPO_MAP_SCORE_WEIGHTS.IMPORT_COUNT_MULTIPLIER;

    if (importScore > 0) {
      score += importScore;

      reasons.push({
        type: "import_count",
        score: importScore,

        evidence: `The file has ${inboundImportCount} inbound imports.`,
      });
    }

    const pageRankScore =
      pageRank * REPO_MAP_SCORE_WEIGHTS.PAGE_RANK_MULTIPLIER;

    if (pageRankScore > 0) {
      score += pageRankScore;

      reasons.push({
        type: "page_rank",
        score: pageRankScore,

        evidence: `File graph PageRank is ${pageRank.toFixed(6)}.`,
      });
    }

    const basename = file.relativePath.split("/").pop() ?? "";

    if (REPO_MAP_PATTERNS.ENTRY_POINT.test(basename)) {
      score += REPO_MAP_SCORE_WEIGHTS.ENTRY_POINT;

      reasons.push({
        type: "entry_point",

        score: REPO_MAP_SCORE_WEIGHTS.ENTRY_POINT,

        evidence: `"${basename}" matches a conventional entry-point filename.`,
      });
    }

    return {
      file,
      symbols,
      score,
      pageRank,
      inboundImportCount,
      outboundImportCount,
      referenceCount,
      reasons,
    };
  }

  private computeFilePageRank(
    files: readonly RepoMapFile[],
    imports: readonly RepoMapImport[],
    references: readonly RepoMapReference[],
    personalization: ReadonlyMap<string, number>,
  ): Map<string, number> {
    const fileIds = new Set(files.map((file) => file.id));

    const edges: Array<{
      from: string;
      to: string;
      weight: number;
    }> = [];

    for (const item of imports) {
      if (
        !item.toFileId ||
        !fileIds.has(item.toFileId) ||
        item.fromFileId === item.toFileId
      ) {
        continue;
      }

      edges.push({
        from: item.fromFileId,
        to: item.toFileId,

        weight: REPO_MAP_SCORE_WEIGHTS.IMPORT_EDGE,
      });
    }

    for (const item of references) {
      if (
        !item.toFileId ||
        !fileIds.has(item.toFileId) ||
        item.fromFileId === item.toFileId
      ) {
        continue;
      }

      edges.push({
        from: item.fromFileId,
        to: item.toFileId,

        weight: REPO_MAP_SCORE_WEIGHTS.REFERENCE_EDGE,
      });
    }

    return computePageRank(
      files.map((file) => file.id),
      edges,
      {
        damping: this.pageRankDamping,

        iterations: this.pageRankIterations,

        personalization,
      },
    );
  }

  private buildPersonalization(
    files: readonly RepoMapFile[],
    context: RepoMapRankingInput["context"],
  ): Map<string, number> {
    const result = new Map<string, number>();

    for (const file of files) {
      let weight = REPO_MAP_SCORE_WEIGHTS.PERSONALIZATION_BASE;

      if (this.matchesSelection(file, context.currentFile)) {
        weight += REPO_MAP_SCORE_WEIGHTS.PERSONALIZATION_CURRENT_FILE;
      }

      if (this.matchesAnySelection(file, context.openFiles)) {
        weight += REPO_MAP_SCORE_WEIGHTS.PERSONALIZATION_OPEN_FILE;
      }

      if (this.matchesAnySelection(file, context.gitDiffFiles)) {
        weight += REPO_MAP_SCORE_WEIGHTS.PERSONALIZATION_GIT_DIFF_FILE;
      }

      if (this.matchesAnySelection(file, context.diagnosticFiles)) {
        weight += REPO_MAP_SCORE_WEIGHTS.PERSONALIZATION_DIAGNOSTIC_FILE;
      }

      if (this.matchesAnySelection(file, context.recentEditFiles)) {
        weight += REPO_MAP_SCORE_WEIGHTS.PERSONALIZATION_RECENT_EDIT_FILE;
      }

      result.set(file.id, weight);
    }

    return result;
  }

  private enforceSnapshotMembership(
    files: readonly RepoMapFile[],
    snapshot: RepoMapRankingInput["snapshot"],
  ): RepoMapFile[] {
    const allowed = new Set(
      snapshot.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => this.fileKey(entry.rootId, entry.relativePath)),
    );

    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();

    const result: RepoMapFile[] = [];

    for (const file of files) {
      const pathKey = this.fileKey(file.rootId, file.relativePath);

      if (!allowed.has(pathKey)) {
        continue;
      }

      if (seenIds.has(file.id) || seenPaths.has(pathKey)) {
        continue;
      }

      seenIds.add(file.id);
      seenPaths.add(pathKey);
      result.push({ ...file });
    }

    return result;
  }

  private attachProjectIds(
    files: readonly RepoMapFile[],
    catalog: ProjectCatalog,
  ): RepoMapFile[] {
    return files.map((file) => {
      if (file.projectId) {
        return file;
      }

      const owner = this.findOwningProject(file, catalog.projects);

      return owner
        ? {
            ...file,
            projectId: owner.id,
          }
        : file;
    });
  }

  private findOwningProject(
    file: RepoMapFile,
    projects: readonly ProjectDefinition[],
  ): ProjectDefinition | undefined {
    return projects
      .filter(
        (project) =>
          project.rootId === file.rootId &&
          this.isWithinRoot(file.relativePath, project.relativeRoot),
      )
      .sort(
        (left, right) =>
          this.pathDepth(right.relativeRoot) -
          this.pathDepth(left.relativeRoot),
      )[0];
  }

  private selectSymbols(symbols: readonly RepoMapSymbol[]): RepoMapSymbol[] {
    return [...symbols]
      .sort((left, right) => {
        const priorityDifference =
          (REPO_MAP_SYMBOL_KIND_PRIORITY[right.kind] ?? 0) -
          (REPO_MAP_SYMBOL_KIND_PRIORITY[left.kind] ?? 0);

        if (priorityDifference !== 0) {
          return priorityDifference;
        }

        const lineDifference =
          (left.startLine ?? Number.MAX_SAFE_INTEGER) -
          (right.startLine ?? Number.MAX_SAFE_INTEGER);

        if (lineDifference !== 0) {
          return lineDifference;
        }

        return left.name.localeCompare(right.name);
      })
      .slice(0, this.maximumSymbolsPerFile);
  }

  private countInboundImports(
    imports: readonly RepoMapImport[],
  ): Map<string, number> {
    const counts = new Map<string, number>();

    for (const item of imports) {
      if (!item.toFileId) {
        continue;
      }

      counts.set(item.toFileId, (counts.get(item.toFileId) ?? 0) + 1);
    }

    return counts;
  }

  private countOutboundImports(
    imports: readonly RepoMapImport[],
  ): Map<string, number> {
    const counts = new Map<string, number>();

    for (const item of imports) {
      counts.set(item.fromFileId, (counts.get(item.fromFileId) ?? 0) + 1);
    }

    return counts;
  }

  private countReferences(
    references: readonly RepoMapReference[],
  ): Map<string, number> {
    const counts = new Map<string, number>();

    for (const item of references) {
      counts.set(item.fromFileId, (counts.get(item.fromFileId) ?? 0) + 1);
    }

    return counts;
  }

  private addSelectionSignal(
    reasons: RepoMapScoreReason[],
    file: RepoMapFile,
    selection: RepoMapFileSelection | undefined,
    type: RepoMapScoreReasonType,
    score: number,
  ): number {
    if (!this.matchesSelection(file, selection)) {
      return 0;
    }

    reasons.push({
      type,
      score,

      evidence: `"${file.relativePath}" matched ${type}.`,
    });

    return score;
  }

  private addSelectionListSignal(
    reasons: RepoMapScoreReason[],
    file: RepoMapFile,
    selections: readonly RepoMapFileSelection[] | undefined,
    type: RepoMapScoreReasonType,
    score: number,
  ): number {
    if (!this.matchesAnySelection(file, selections)) {
      return 0;
    }

    reasons.push({
      type,
      score,

      evidence: `"${file.relativePath}" matched ${type}.`,
    });

    return score;
  }

  private matchesAnySelection(
    file: RepoMapFile,
    selections: readonly RepoMapFileSelection[] | undefined,
  ): boolean {
    return (
      selections?.some((selection) => this.matchesSelection(file, selection)) ??
      false
    );
  }

  private matchesSelection(
    file: RepoMapFile,
    selection: RepoMapFileSelection | undefined,
  ): boolean {
    if (!selection) {
      return false;
    }

    if (typeof selection === "string") {
      return file.relativePath === this.normalizeRelativePath(selection);
    }

    if (selection.rootId && selection.rootId !== file.rootId) {
      return false;
    }

    return (
      file.relativePath === this.normalizeRelativePath(selection.relativePath)
    );
  }

  private tokenize(query?: string): string[] {
    if (!query) {
      return [];
    }

    return [
      ...new Set(
        query
          .toLowerCase()
          .split(/\W+/)
          .map((term) => term.trim())
          .filter((term) => term.length > 1),
      ),
    ];
  }

  private validateSnapshotCatalog(input: RepoMapRankingInput): void {
    if (input.catalog.workspaceSnapshotId !== input.snapshot.snapshotId) {
      throw new Error(
        "ProjectCatalog was not generated from the supplied WorkspaceSnapshot.",
      );
    }
  }

  private fileKey(rootId: string, relativePath: string): string {
    return `${rootId}\u0000` + this.normalizeRelativePath(relativePath);
  }

  private isWithinRoot(candidate: string, root: string): boolean {
    const normalizedCandidate = this.normalizeRelativePath(candidate);

    const normalizedRoot = this.normalizeRelativePath(root);

    return (
      !normalizedRoot ||
      normalizedCandidate === normalizedRoot ||
      normalizedCandidate.startsWith(`${normalizedRoot}/`)
    );
  }

  private pathDepth(value: string): number {
    const normalized = this.normalizeRelativePath(value);

    return normalized ? normalized.split("/").length : 0;
  }

  private normalizeRelativePath(value: string): string {
    return value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");
  }

  private validateOptions(): void {
    this.validatePositiveInteger(this.maximumFiles, "maximumFiles");

    this.validatePositiveInteger(this.symbolBatchSize, "symbolBatchSize");

    this.validatePositiveInteger(this.graphBatchSize, "graphBatchSize");

    this.validatePositiveInteger(
      this.maximumSymbolsPerFile,
      "maximumSymbolsPerFile",
    );

    this.validateNonNegativeInteger(
      this.pageRankIterations,
      "pageRankIterations",
    );

    if (
      !Number.isFinite(this.pageRankDamping) ||
      this.pageRankDamping < 0 ||
      this.pageRankDamping > 1
    ) {
      throw new RangeError("pageRankDamping must be between 0 and 1.");
    }
  }

  private validatePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }

  private validateNonNegativeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer.`);
    }
  }
}
