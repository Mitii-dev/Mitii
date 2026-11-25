import type {
  FileSystemEntry,
  FileSystemReadPort,
  FileSystemStat,
} from "../filesystem";

import { PathNormalizer } from "../path-normalizer";
import { processSymbolicLink } from "./symbolicLinkWalker";
import {
  checkStop,
  stopForMaximumDirectories,
  stopForMaximumFiles,
} from "./walkControl";
import {
  createWalkState,
  errorMessage,
  isMissingPathError,
  normalizeWalkOptions,
} from "./walkSupport";

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
    const options = normalizeWalkOptions(input);

    const state = createWalkState();

    const roots = [...new Set(input.roots)]
      .map((root) => this.pathNormalizer.normalizePhysical(root))
      .sort((left, right) => left.localeCompare(right));

    for (const root of roots) {
      if (state.stopped || checkStop(options, state, root)) {
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
      if (isMissingPathError(error)) {
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
            errorMessage(error),
        });
      }

      return;
    }

    if (checkStop(options, state, root)) {
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
      if (checkStop(options, state, root)) {
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
    if (checkStop(options, state, root)) {
      return;
    }

    if (state.filesVisited >= options.maximumFiles) {
      stopForMaximumFiles(root, state);

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
    if (checkStop(options, state, directory.path)) {
      return;
    }

    if (state.directoriesVisited >= options.maximumDirectories) {
      stopForMaximumDirectories(directory.path, state);

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
          errorMessage(error),
      });

      return;
    }

    if (checkStop(options, state, directory.path)) {
      return;
    }

    const sortedEntries = [...entries].sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of sortedEntries) {
      if (state.stopped || checkStop(options, state, entry.path)) {
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
            errorMessage(error),
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
        await processSymbolicLink(
          this.fileSystem,
          this.pathNormalizer,
          item,
          queue,
          options,
          state,
        );

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
    if (checkStop(options, state, item.path)) {
      return;
    }

    if (state.filesVisited >= options.maximumFiles) {
      stopForMaximumFiles(item.path, state);

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
          errorMessage(error),
      });
    }

    if (checkStop(options, state, item.path)) {
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
          errorMessage(error),
      });

      /*
       * Do not silently exclude an entry when ignore policy
       * evaluation fails.
       */
      return false;
    }
  }

}
