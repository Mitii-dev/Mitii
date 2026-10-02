/**
 * Cheap BFS workspace sketch (gemini-cli getFolderStructure formula inject).
 * Builds an indented tree from relative paths with a hard item budget so
 * cold-start / empty-assembly orientation stays broad rather than depth-first.
 */

export const WORKSPACE_SKETCH_DEFAULTS = {
  MAXIMUM_ITEMS: 200,
  MAXIMUM_CHARS: 24_000,
  TRUNCATION_INDICATOR: "...",
} as const;

export type WorkspaceSketchOptions = {
  maximumItems?: number;
  maximumCharacters?: number;
  rootLabel?: string;
};

export type WorkspaceSketchResult = {
  content: string;
  includedItems: number;
  truncated: boolean;
};

type SketchDir = {
  name: string;
  files: string[];
  dirs: Map<string, SketchDir>;
};

/**
 * Prefer shallower coverage: BFS-pack a path list into a truncated tree string.
 */
export function buildWorkspaceSketch(
  paths: readonly string[],
  options: WorkspaceSketchOptions = {},
): WorkspaceSketchResult {
  const maximumItems = Math.max(
    1,
    options.maximumItems ?? WORKSPACE_SKETCH_DEFAULTS.MAXIMUM_ITEMS,
  );
  const maximumCharacters = Math.max(
    64,
    options.maximumCharacters ??
      WORKSPACE_SKETCH_DEFAULTS.MAXIMUM_CHARS,
  );
  const rootLabel = options.rootLabel?.trim() || ".";

  const root: SketchDir = {
    name: rootLabel,
    files: [],
    dirs: new Map(),
  };

  const normalized = [
    ...new Set(
      paths
        .map((path) => path.trim().replace(/\\/g, "/"))
        .filter((path) => path.length > 0 && !path.startsWith("/")),
    ),
  ].sort((left, right) => left.localeCompare(right));

  for (const relativePath of normalized) {
    insertPath(root, relativePath);
  }

  const packed = packBreadthFirst(root, maximumItems);
  const lines: string[] = [packed.root.name];
  formatDir(packed.root, "", true, lines, true);

  let content = lines.join("\n");
  let truncated = packed.truncated;
  if (content.length > maximumCharacters) {
    content = `${content.slice(0, maximumCharacters)}\n${WORKSPACE_SKETCH_DEFAULTS.TRUNCATION_INDICATOR}`;
    truncated = true;
  }

  return {
    content,
    includedItems: packed.includedItems,
    truncated,
  };
}

function insertPath(root: SketchDir, relativePath: string): void {
  const segments = relativePath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) {
    return;
  }

  let node = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const name = segments[index]!;
    let child = node.dirs.get(name);
    if (!child) {
      child = { name, files: [], dirs: new Map() };
      node.dirs.set(name, child);
    }
    node = child;
  }

  const basename = segments[segments.length - 1]!;
  if (!node.files.includes(basename)) {
    node.files.push(basename);
  }
}

type PackedDir = {
  name: string;
  files: string[];
  dirs: PackedDir[];
  hasMoreFiles: boolean;
  hasMoreDirs: boolean;
};

function packBreadthFirst(
  root: SketchDir,
  maximumItems: number,
): {
  root: PackedDir;
  includedItems: number;
  truncated: boolean;
} {
  // Root label itself counts as one orientation item.
  let includedItems = 1;
  let truncated = false;

  const packedRoot: PackedDir = {
    name: root.name,
    files: [],
    dirs: [],
    hasMoreFiles: false,
    hasMoreDirs: false,
  };

  type QueueEntry = {
    source: SketchDir;
    target: PackedDir;
  };

  const queue: QueueEntry[] = [{ source: root, target: packedRoot }];

  while (queue.length > 0) {
    const { source, target } = queue.shift()!;
    const fileNames = [...source.files].sort((left, right) =>
      left.localeCompare(right),
    );
    const dirNames = [...source.dirs.keys()].sort((left, right) =>
      left.localeCompare(right),
    );

    for (const fileName of fileNames) {
      if (includedItems >= maximumItems) {
        target.hasMoreFiles = true;
        truncated = true;
        break;
      }
      target.files.push(fileName);
      includedItems += 1;
    }
    if (target.hasMoreFiles) {
      // Still mark remaining dirs as truncated for this node.
      if (dirNames.length > 0) {
        target.hasMoreDirs = true;
        truncated = true;
      }
      continue;
    }

    for (const dirName of dirNames) {
      if (includedItems >= maximumItems) {
        target.hasMoreDirs = true;
        truncated = true;
        break;
      }
      const childSource = source.dirs.get(dirName)!;
      const childTarget: PackedDir = {
        name: dirName,
        files: [],
        dirs: [],
        hasMoreFiles: false,
        hasMoreDirs: false,
      };
      target.dirs.push(childTarget);
      includedItems += 1;
      queue.push({ source: childSource, target: childTarget });
    }
  }

  return { root: packedRoot, includedItems, truncated };
}

function formatDir(
  node: PackedDir,
  indent: string,
  isLast: boolean,
  lines: string[],
  isRoot: boolean,
): void {
  if (!isRoot) {
    const connector = isLast ? "└───" : "├───";
    lines.push(`${indent}${connector}${node.name}/`);
  }

  const childIndent = isRoot
    ? ""
    : `${indent}${isLast ? "    " : "│   "}`;

  const fileCount = node.files.length;
  const dirCount = node.dirs.length;

  for (let index = 0; index < fileCount; index += 1) {
    const lastFile =
      index === fileCount - 1 &&
      dirCount === 0 &&
      !node.hasMoreFiles &&
      !node.hasMoreDirs;
    const connector = lastFile ? "└───" : "├───";
    lines.push(`${childIndent}${connector}${node.files[index]}`);
  }

  if (node.hasMoreFiles) {
    const lastIndicator =
      dirCount === 0 && !node.hasMoreDirs;
    const connector = lastIndicator ? "└───" : "├───";
    lines.push(
      `${childIndent}${connector}${WORKSPACE_SKETCH_DEFAULTS.TRUNCATION_INDICATOR}`,
    );
  }

  for (let index = 0; index < dirCount; index += 1) {
    const lastDir =
      index === dirCount - 1 && !node.hasMoreDirs;
    formatDir(node.dirs[index]!, childIndent, lastDir, lines, false);
  }

  if (node.hasMoreDirs) {
    lines.push(
      `${childIndent}└───${WORKSPACE_SKETCH_DEFAULTS.TRUNCATION_INDICATOR}`,
    );
  }
}
