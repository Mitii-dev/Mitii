import type {
  FileSystemEntry,
  FileSystemReadPort,
  FileSystemStat,
} from "../filesystem";

import { PathNormalizer } from "../path-normalizer";
import { BOUNDED_WALKER_CONSTANTS } from "./constants";

import type {
  BoundedWalkIgnoreContext,
  BoundedWalkInput,
  BoundedWalkResult,
  DirectoryQueueItem,
  NormalizedWalkOptions,
  WalkState,
} from "./types";

export class BoundedWalker {
  constructor(
    private readonly fileSystem: FileSystemReadPort,

    private readonly pathNormalizer: PathNormalizer = new PathNormalizer(),
  ) {}

  public async walk(input: BoundedWalkInput): Promise<BoundedWalkResult> {
    const options = this.normalizeOptions(input);

    const state = this.createState();

    const roots = [...new Set(input.roots)]
      .map((root) => this.pathNormalizer.normalizePhysical(root))
      .sort((left, right) => left.localeCompare(right));

    for (const root of roots) {
      if (state.stopped || this.checkStop(options, state, root)) {
        break;
      }

      await this.walkRoot(root, options, state);
    }

    state.entries.sort((left, right) => {
      const rootComparison = left.root.localeCompare(right.root);

      if (rootComparison !== 0) {
        return rootComparison;
      }

      return left.relativePath.localeCompare(right.relativePath);
    });

    return {
      entries: state.entries,
      warnings: state.warnings,

      filesVisited: state.filesVisited,
      directoriesVisited: state.directoriesVisited,

      symbolicLinksVisited: state.symbolicLinksVisited,

      ignoredEntries: state.ignoredEntries,

      complete: !state.truncated && !state.cancelled && !state.timedOut,

      truncated: state.truncated,
      cancelled: state.cancelled,
      timedOut: state.timedOut,
    };
  }

  private async walkRoot(
    root: string,
    options: NormalizedWalkOptions,
    state: WalkState,
  ): Promise<void> {
    let rootStat: FileSystemStat;

    try {
      rootStat = await this.fileSystem.stat(root);
    } catch (error) {
      if (this.isMissingPathError(error)) {
        state.warnings.push({
          code: "root_not_found",
          path: root,
          message: `Workspace root does not exist: ` + `"${root}".`,
        });
      } else {
        state.warnings.push({
          code: "stat_failed",
          path: root,
          message:
            `Unable to inspect workspace root ` +
            `"${root}": ` +
            this.errorMessage(error),
        });
      }

      return;
    }

    if (this.checkStop(options, state, root)) {
      return;
    }

    if (rootStat.kind === "file") {
      await this.addRootFile(root, rootStat, options, state);

      return;
    }

    if (rootStat.kind !== "directory") {
      state.warnings.push({
        code: "root_not_directory",
        path: root,
        message: `Workspace root is not a directory: ` + `"${root}".`,
      });

      return;
    }

    let rootRealPath = root;

    if (options.followSymbolicLinks) {
      try {
        rootRealPath = await this.fileSystem.realPath(root);
      } catch {
        /*
         * Some remote providers do not support realPath().
         * Continue safely; individual links may be skipped.
         */
      }
    }

    state.visitedRealDirectories.add(rootRealPath);

    const queue: DirectoryQueueItem[] = [
      {
        root,
        rootRealPath,
        path: root,
        relativePath: "",
        depth: 0,
      },
    ];

    /*
     * Use a cursor instead of Array.shift().
     * Array.shift() reindexes the entire queue.
     */
    let queueIndex = 0;

    while (queueIndex < queue.length && !state.stopped) {
      if (this.checkStop(options, state, root)) {
        break;
      }

      const directory = queue[queueIndex];

      queueIndex += 1;

      if (!directory) {
        break;
      }

      await this.walkDirectory(directory, queue, options, state);
    }
  }

  private async addRootFile(
    root: string,
    stat: FileSystemStat,
    options: NormalizedWalkOptions,
    state: WalkState,
  ): Promise<void> {
    if (this.checkStop(options, state, root)) {
      return;
    }

    if (state.filesVisited >= options.maximumFiles) {
      this.stopForMaximumFiles(root, state);

      return;
    }

    const relativePath = this.pathNormalizer.normalizeRelative(
      this.pathNormalizer.basename(root),
    );

    const ignoreContext: BoundedWalkIgnoreContext = {
      root,
      path: root,
      relativePath,
      depth: 0,
      kind: "file",
    };

    if (await this.shouldIgnore(ignoreContext, options, state)) {
      state.ignoredEntries += 1;
      return;
    }

    state.entries.push({
      root,
      path: root,
      relativePath,
      depth: 0,
      kind: "file",
      size: stat.size,
      modifiedAt: stat.modifiedAt,
    });

    state.filesVisited += 1;
  }

  private async walkDirectory(
    directory: DirectoryQueueItem,
    queue: DirectoryQueueItem[],
    options: NormalizedWalkOptions,
    state: WalkState,
  ): Promise<void> {
    if (this.checkStop(options, state, directory.path)) {
      return;
    }

    if (state.directoriesVisited >= options.maximumDirectories) {
      this.stopForMaximumDirectories(directory.path, state);

      return;
    }

    state.directoriesVisited += 1;

    let entries: readonly FileSystemEntry[];

    try {
      entries = await this.fileSystem.readDirectory(directory.path);
    } catch (error) {
      state.warnings.push({
        code: "read_failed",
        path: directory.path,
        message:
          `Unable to read directory ` +
          `"${directory.path}": ` +
          this.errorMessage(error),
      });

      return;
    }

    if (this.checkStop(options, state, directory.path)) {
      return;
    }

    const sortedEntries = [...entries].sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of sortedEntries) {
      if (state.stopped || this.checkStop(options, state, entry.path)) {
        return;
      }

      const depth = directory.depth + 1;

      let relativePath: string;

      try {
        relativePath = this.pathNormalizer.relativeToRoot(
          directory.root,
          entry.path,
        );
      } catch (error) {
        state.warnings.push({
          code: "outside_root",
          path: entry.path,
          message:
            `Unable to create a workspace-relative ` +
            `path for "${entry.path}": ` +
            this.errorMessage(error),
        });

        continue;
      }

      const ignoreContext: BoundedWalkIgnoreContext = {
        root: directory.root,
        path: entry.path,
        relativePath,
        depth,
        kind: entry.kind,
      };

      if (await this.shouldIgnore(ignoreContext, options, state)) {
        state.ignoredEntries += 1;
        continue;
      }

      await this.processEntry(
        entry,
        {
          root: directory.root,
          rootRealPath: directory.rootRealPath,
          path: entry.path,
          relativePath,
          depth,
        },
        queue,
        options,
        state,
      );
    }
  }

  private async processEntry(
    entry: FileSystemEntry,
    item: DirectoryQueueItem,
    queue: DirectoryQueueItem[],
    options: NormalizedWalkOptions,
    state: WalkState,
  ): Promise<void> {
    switch (entry.kind) {
      case "file": {
        await this.processFile(item, options, state);

        return;
      }

      case "directory": {
        this.processDirectory(item, queue, options, state);

        return;
      }

      case "symbolic_link": {
        await this.processSymbolicLink(item, queue, options, state);

        return;
      }

      case "other":
      default: {
        state.entries.push({
          root: item.root,
          path: item.path,
          relativePath: item.relativePath,
          depth: item.depth,
          kind: "other",
        });
      }
    }
  }

  private async processFile(
    item: DirectoryQueueItem,
    options: NormalizedWalkOptions,
    state: WalkState,
  ): Promise<void> {
    if (this.checkStop(options, state, item.path)) {
      return;
    }

    if (state.filesVisited >= options.maximumFiles) {
      this.stopForMaximumFiles(item.path, state);

      return;
    }

    let stat: FileSystemStat | undefined;

    try {
      stat = await this.fileSystem.stat(item.path);
    } catch (error) {
      state.warnings.push({
        code: "stat_failed",
        path: item.path,
        message:
          `Unable to inspect file ` +
          `"${item.path}": ` +
          this.errorMessage(error),
      });
    }

    if (this.checkStop(options, state, item.path)) {
      return;
    }

    state.entries.push({
      root: item.root,
      path: item.path,
      relativePath: item.relativePath,
      depth: item.depth,
      kind: "file",
      size: stat?.size,
      modifiedAt: stat?.modifiedAt,
    });

    state.filesVisited += 1;
  }

  private processDirectory(
    item: DirectoryQueueItem,
    queue: DirectoryQueueItem[],
    options: NormalizedWalkOptions,
    state: WalkState,
  ): void {
    state.entries.push({
      root: item.root,
      path: item.path,
      relativePath: item.relativePath,
      depth: item.depth,
      kind: "directory",
    });

    if (item.depth >= options.maximumDepth) {
      state.truncated = true;

      state.warnings.push({
        code: "maximum_depth_reached",
        path: item.path,
        message:
          `Maximum traversal depth of ` +
          `${options.maximumDepth} was reached.`,
      });

      return;
    }

    /*
     * Register ordinary directories as well as symlink targets.
     * This improves cycle detection when a later symlink points
     * to a directory already reachable through the normal tree.
     */
    state.visitedRealDirectories.add(
      this.pathNormalizer.normalizePhysical(item.path),
    );

    queue.push(item);
  }

  private async processSymbolicLink(
    item: DirectoryQueueItem,
    queue: DirectoryQueueItem[],
    options: NormalizedWalkOptions,
    state: WalkState,
  ): Promise<void> {
    state.symbolicLinksVisited += 1;

    let stat: FileSystemStat | undefined;

    try {
      stat = await this.fileSystem.stat(item.path);
    } catch (error) {
      state.warnings.push({
        code: "stat_failed",
        path: item.path,
        message:
          `Unable to inspect symbolic link ` +
          `"${item.path}": ` +
          this.errorMessage(error),
      });
    }

    //INFO: exactOptionalPropertyTypes: true 
    state.entries.push({
      root: item.root,
      path: item.path,
      relativePath: item.relativePath,
      depth: item.depth,
      kind: "symbolic_link",

      ...(stat?.size !== undefined
        ? {
            size: stat.size,
          }
        : {}),

      ...(stat?.modifiedAt
        ? {
            modifiedAt: stat.modifiedAt,
          }
        : {}),

      ...(stat?.symbolicLinkTarget
        ? {
            linkTarget: stat.symbolicLinkTarget,
          }
        : {}),
    });

    if (!options.followSymbolicLinks) {
      state.warnings.push({
        code: "symbolic_link_skipped",
        path: item.path,
        message: "Symbolic-link traversal is disabled.",
      });

      return;
    }

    if (this.checkStop(options, state, item.path)) {
      return;
    }

    let realPath: string;
    let targetStat: FileSystemStat;

    try {
      realPath = await this.fileSystem.realPath(item.path);
      targetStat = await this.fileSystem.stat(realPath);
    } catch (error) {
      state.warnings.push({
        code: "symbolic_link_resolution_failed",
        path: item.path,
        message:
          `Unable to resolve symbolic link ` +
          `"${item.path}": ` +
          this.errorMessage(error),
      });

      return;
    }

    if (!this.pathNormalizer.isWithinRoot(item.rootRealPath, realPath)) {
      state.warnings.push({
        code: "outside_root",
        path: item.path,
        message:
          `Symbolic link resolves outside workspace ` + `root: "${realPath}".`,
      });

      return;
    }

    if (targetStat.kind !== "directory") {
      return;
    }

    const normalizedRealPath = this.pathNormalizer.normalizePhysical(realPath);

    if (state.visitedRealDirectories.has(normalizedRealPath)) {
      state.warnings.push({
        code: "symbolic_link_cycle",
        path: item.path,
        message:
          `Symbolic link resolves to an already ` +
          `visited directory: "${realPath}".`,
      });

      return;
    }

    if (item.depth >= options.maximumDepth) {
      state.truncated = true;

      state.warnings.push({
        code: "maximum_depth_reached",
        path: item.path,
        message:
          `Maximum traversal depth of ` +
          `${options.maximumDepth} was reached.`,
      });

      return;
    }

    state.visitedRealDirectories.add(normalizedRealPath);

    queue.push({
      ...item,
      path: realPath,
    });
  }

  private async shouldIgnore(
    context: BoundedWalkIgnoreContext,
    options: NormalizedWalkOptions,
    state: WalkState,
  ): Promise<boolean> {
    if (!options.shouldIgnore) {
      return false;
    }

    try {
      return await options.shouldIgnore(context);
    } catch (error) {
      state.warnings.push({
        code: "ignore_policy_failed",
        path: context.path,
        message:
          `Ignore policy failed for ` +
          `"${context.path}": ` +
          this.errorMessage(error),
      });

      /*
       * Do not silently exclude an entry when ignore policy
       * evaluation fails.
       */
      return false;
    }
  }

  private checkStop(
    options: NormalizedWalkOptions,
    state: WalkState,
    currentPath: string,
  ): boolean {
    if (this.checkCancellation(options, state, currentPath)) {
      return true;
    }

    return this.checkTimeout(options, state, currentPath);
  }

  private checkCancellation(
    options: NormalizedWalkOptions,
    state: WalkState,
    currentPath: string,
  ): boolean {
    if (!options.abortSignal?.aborted) {
      return false;
    }

    if (!state.cancelled) {
      state.cancelled = true;
      state.stopped = true;

      state.warnings.push({
        code: "cancelled",
        path: currentPath,
        message: "Workspace traversal was cancelled.",
      });
    }

    return true;
  }

  private checkTimeout(
    options: NormalizedWalkOptions,
    state: WalkState,
    currentPath: string,
  ): boolean {
    if (Date.now() < options.deadline) {
      return false;
    }

    state.timedOut = true;
    state.truncated = true;
    state.stopped = true;

    if (!state.reportedTimeout) {
      state.reportedTimeout = true;

      state.warnings.push({
        code: "timeout_reached",
        path: currentPath,
        message:
          `Workspace traversal exceeded its ` +
          `${options.timeoutMs}ms time limit.`,
      });
    }

    return true;
  }

  private stopForMaximumFiles(currentPath: string, state: WalkState): void {
    state.truncated = true;
    state.stopped = true;

    if (state.reportedMaximumFiles) {
      return;
    }

    state.reportedMaximumFiles = true;

    state.warnings.push({
      code: "maximum_files_reached",
      path: currentPath,
      message: "The maximum file limit was reached.",
    });
  }

  private stopForMaximumDirectories(
    currentPath: string,
    state: WalkState,
  ): void {
    state.truncated = true;
    state.stopped = true;

    if (state.reportedMaximumDirectories) {
      return;
    }

    state.reportedMaximumDirectories = true;

    state.warnings.push({
      code: "maximum_directories_reached",
      path: currentPath,
      message: "The maximum directory limit was reached.",
    });
  }

  private normalizeOptions(input: BoundedWalkInput): NormalizedWalkOptions {
    const maximumDepth =
      input.maximumDepth ?? BOUNDED_WALKER_CONSTANTS.DEFAULT_MAXIMUM_DEPTH;

    const maximumFiles =
      input.maximumFiles ?? BOUNDED_WALKER_CONSTANTS.DEFAULT_MAXIMUM_FILES;

    const maximumDirectories =
      input.maximumDirectories ??
      BOUNDED_WALKER_CONSTANTS.DEFAULT_MAXIMUM_DIRECTORIES;

    const timeoutMs =
      input.timeoutMs ?? BOUNDED_WALKER_CONSTANTS.DEFAULT_TIMEOUT_MS;

    this.validateLimit("maximumDepth", maximumDepth, true);

    this.validateLimit("maximumFiles", maximumFiles, false);

    this.validateLimit("maximumDirectories", maximumDirectories, false);

    this.validateLimit("timeoutMs", timeoutMs, false);

    return {
      maximumDepth,
      maximumFiles,
      maximumDirectories,

      timeoutMs,
      deadline: Date.now() + timeoutMs,

      followSymbolicLinks: input.followSymbolicLinks ?? false,

      shouldIgnore: input.shouldIgnore,
      abortSignal: input.abortSignal,
    };
  }

  private createState(): WalkState {
    return {
      entries: [],
      warnings: [],

      filesVisited: 0,
      directoriesVisited: 0,
      symbolicLinksVisited: 0,
      ignoredEntries: 0,

      truncated: false,
      cancelled: false,
      timedOut: false,
      stopped: false,

      reportedMaximumFiles: false,
      reportedMaximumDirectories: false,
      reportedTimeout: false,

      visitedRealDirectories: new Set<string>(),
    };
  }

  private validateLimit(name: string, value: number, allowZero: boolean): void {
    const minimum = allowZero ? 0 : 1;

    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new RangeError(
        `${name} must be a safe integer ` +
          `greater than or equal to ${minimum}.`,
      );
    }
  }

  private isMissingPathError(error: unknown): boolean {
    const code = this.getErrorCode(error);

    return (
      code === "ENOENT" ||
      code === "ENOTDIR" ||
      code === "FileNotFound" ||
      code === "EntryNotFound"
    );
  }

  private getErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object" || !("code" in error)) {
      return undefined;
    }

    return String(error.code);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
