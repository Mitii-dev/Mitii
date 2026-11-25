import type { FileSystemReadPort, FileSystemStat } from "../filesystem";
import type { PathNormalizer } from "../path-normalizer";
import { checkStop } from "./walkControl";
import { errorMessage } from "./walkSupport";
import type {
  DirectoryQueueItem,
  NormalizedWalkOptions,
  WalkState,
} from "./types";

export async function processSymbolicLink(
  fileSystem: FileSystemReadPort,
  pathNormalizer: PathNormalizer,
  item: DirectoryQueueItem,
  queue: DirectoryQueueItem[],
  options: NormalizedWalkOptions,
  state: WalkState,
): Promise<void> {
  state.symbolicLinksVisited += 1;

  let stat: FileSystemStat | undefined;

  try {
    stat = await fileSystem.stat(item.path);
  } catch (error) {
    state.warnings.push({
      code: "stat_failed",
      path: item.path,
      message:
        `Unable to inspect symbolic link ` +
        `"${item.path}": ` +
        errorMessage(error),
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

  if (checkStop(options, state, item.path)) {
    return;
  }

  let realPath: string;
  let targetStat: FileSystemStat;

  try {
    realPath = await fileSystem.realPath(item.path);
    targetStat = await fileSystem.stat(realPath);
  } catch (error) {
    state.warnings.push({
      code: "symbolic_link_resolution_failed",
      path: item.path,
      message:
        `Unable to resolve symbolic link ` +
        `"${item.path}": ` +
        errorMessage(error),
    });

    return;
  }

  if (!pathNormalizer.isWithinRoot(item.rootRealPath, realPath)) {
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

  const normalizedRealPath = pathNormalizer.normalizePhysical(realPath);

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
