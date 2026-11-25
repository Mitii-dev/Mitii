import type { RepoGraphEdgeAccumulator } from "./RepoGraphEdgeAccumulator";
import type { RepoGraphFileNode } from "./types";

const CONFIG_FILE_PATTERN =
  /(?:^|\/)(?:tsconfig(?:\.[^/]+)?|jsconfig(?:\.[^/]+)?)\.json$/i;

/**
 * Emit file→file `depends_on` edges from tsconfig/jsconfig `extends`.
 * Requires a host-supplied text reader; skips silently when unavailable.
 */
export async function loadConfigExtendsEdges(params: {
  fileNodes: readonly RepoGraphFileNode[];
  edges: RepoGraphEdgeAccumulator;
  readWorkspaceText?: (params: {
    rootId: string;
    relativePath: string;
  }) => string | undefined | Promise<string | undefined>;
}): Promise<{ edgesAdded: number }> {
  if (!params.readWorkspaceText) {
    return { edgesAdded: 0 };
  }

  const byPath = new Map<string, RepoGraphFileNode>();
  for (const node of params.fileNodes) {
    byPath.set(normalizePath(node.relativePath), node);
  }

  let edgesAdded = 0;
  for (const node of params.fileNodes) {
    if (node.tombstone) continue;
    const path = normalizePath(node.relativePath);
    if (!CONFIG_FILE_PATTERN.test(path)) continue;

    let text: string | undefined;
    try {
      text = await params.readWorkspaceText({
        rootId: node.rootId,
        relativePath: node.relativePath,
      });
    } catch {
      continue;
    }
    if (!text) continue;

    const extendsTarget = parseExtendsTarget(text);
    if (!extendsTarget) continue;

    const resolved = resolveExtendsPath(path, extendsTarget);
    if (!resolved) continue;

    const target =
      byPath.get(resolved) ??
      byPath.get(ensureJsonSuffix(resolved)) ??
      byPath.get(stripJsonSuffix(resolved));
    if (!target || target.id === node.id) continue;

    params.edges.add({
      type: "depends_on",
      fromNodeId: node.id,
      toNodeId: target.id,
      evidence: {
        source: "config_file",
        detail: `extends ${extendsTarget}`,
      },
    });
    edgesAdded += 1;
  }

  return { edgesAdded };
}

function parseExtendsTarget(text: string): string | undefined {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  try {
    const parsed = JSON.parse(withoutComments) as { extends?: unknown };
    return typeof parsed.extends === "string" && parsed.extends.trim().length > 0
      ? parsed.extends.trim()
      : undefined;
  } catch {
    const match = withoutComments.match(
      /"extends"\s*:\s*"([^"]+)"/,
    );
    return match?.[1]?.trim() || undefined;
  }
}

function resolveExtendsPath(
  fromRelativePath: string,
  extendsTarget: string,
): string | undefined {
  // Package-style extends (e.g. @scope/tsconfig) are not file graph edges.
  if (
    !extendsTarget.startsWith(".") &&
    !extendsTarget.startsWith("/") &&
    !extendsTarget.includes("/")
  ) {
    return undefined;
  }
  if (extendsTarget.startsWith("/") || /^[a-zA-Z]:/.test(extendsTarget)) {
    return undefined;
  }

  const fromDir = fromRelativePath.includes("/")
    ? fromRelativePath.slice(0, fromRelativePath.lastIndexOf("/"))
    : "";
  const joined = fromDir
    ? `${fromDir}/${extendsTarget}`
    : extendsTarget;
  return normalizePath(joined);
}

function ensureJsonSuffix(path: string): string {
  return path.endsWith(".json") ? path : `${path}.json`;
}

function stripJsonSuffix(path: string): string {
  return path.endsWith(".json") ? path.slice(0, -".json".length) : path;
}

function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}
