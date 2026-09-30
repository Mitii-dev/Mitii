import type { RequestArtifactReference } from "../request-envelope/types";

/**
 * Path-like tokens after `@`, excluding obvious non-path mentions.
 * Does not load file content — paths only.
 */
const MENTION_PATH =
  /(?<![\w/])@(?:"([^"\n]+)"|'([^'\n]+)'|([^\s,;)\]}>]+))/g;

const LINE_RANGE_SUFFIX = /:(\d+)(?:-(\d+))?$/;

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segment = normalized.split("/").pop() ?? path;
  return segment.length > 0 ? segment : path;
}

function artifactKey(artifact: RequestArtifactReference): string {
  return [
    artifact.kind,
    artifact.path ?? "",
    artifact.name,
    artifact.startLine ?? "",
    artifact.endLine ?? "",
  ].join("\u0000");
}

/**
 * Extract `@path` / `@path:line` / `@path:start-end` mentions into
 * referenced artifact stubs. Mentions remain in the message text.
 */
export function extractMentionArtifacts(
  message: string,
): RequestArtifactReference[] {
  const artifacts: RequestArtifactReference[] = [];
  const seen = new Set<string>();

  for (const match of message.matchAll(MENTION_PATH)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) {
      continue;
    }

    // Skip @mentions that look like people/handles without a path separator
    // or extension (e.g. @alice) — keep @src/foo.ts and @README.
    const hasPathSignal =
      raw.includes("/") ||
      raw.includes("\\") ||
      raw.includes(".") ||
      raw.includes(":");
    if (!hasPathSignal) {
      continue;
    }

    let path = raw;
    let startLine: number | undefined;
    let endLine: number | undefined;

    const range = LINE_RANGE_SUFFIX.exec(raw);
    if (range) {
      path = raw.slice(0, range.index);
      startLine = Number.parseInt(range[1] ?? "", 10);
      endLine = range[2]
        ? Number.parseInt(range[2], 10)
        : startLine;
      if (!Number.isFinite(startLine) || startLine <= 0) {
        startLine = undefined;
        endLine = undefined;
        path = raw;
      }
    }

    if (!path) {
      continue;
    }

    const kind =
      startLine !== undefined ? "selection" : path.endsWith("/") ? "folder" : "file";

    const artifact: RequestArtifactReference = {
      name: basename(path.replace(/\/$/, "") || path),
      path: path.replace(/\/$/, "") || path,
      kind,
      ...(startLine !== undefined ? { startLine } : {}),
      ...(endLine !== undefined ? { endLine } : {}),
    };

    const key = artifactKey(artifact);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    artifacts.push(artifact);
  }

  return artifacts;
}

/**
 * Merge host-supplied artifacts with mention-extracted ones.
 * Host artifacts win on duplicate keys.
 */
export function mergeReferencedArtifacts(
  hostArtifacts: readonly RequestArtifactReference[],
  extracted: readonly RequestArtifactReference[],
): RequestArtifactReference[] {
  const keys = new Set(hostArtifacts.map(artifactKey));
  const merged = [...hostArtifacts];
  for (const artifact of extracted) {
    const key = artifactKey(artifact);
    if (keys.has(key)) {
      continue;
    }
    keys.add(key);
    merged.push(artifact);
  }
  return merged;
}
