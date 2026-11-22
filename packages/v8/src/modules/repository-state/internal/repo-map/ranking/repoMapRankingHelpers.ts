import type {
  RepoGraphFileNode,
} from "../../repo-graph";

import type {
  RepoMapFile,
  RepoMapRankingContext,
} from "../types";

export function normalizePath(
  value: string,
): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
}

export function isInScope(
  file: RepoGraphFileNode,
  context: RepoMapRankingContext,
): boolean {
  if (
    context.rootIds &&
    !context.rootIds.includes(
      file.rootId,
    )
  ) {
    return false;
  }

  const prefix = normalizePath(
    context.folderPrefix ?? "",
  );

  return (
    !prefix ||
    file.relativePath === prefix ||
    file.relativePath.startsWith(
      `${prefix}/`,
    )
  );
}

export function toRepoMapFile(
  node: RepoGraphFileNode,
): RepoMapFile {
  return {
    id: node.id,
    rootId: node.rootId,
    relativePath: node.relativePath,

    ...(node.projectId
      ? { projectId: node.projectId }
      : {}),

    ...(node.language
      ? { language: node.language }
      : {}),

    ...(node.size !== undefined
      ? { size: node.size }
      : {}),

    ...(node.modifiedAt
      ? { modifiedAt: node.modifiedAt }
      : {}),

    ...(node.contentHash
      ? { contentHash: node.contentHash }
      : {}),
  };
}
