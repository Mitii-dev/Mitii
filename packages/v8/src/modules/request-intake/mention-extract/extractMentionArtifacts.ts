import type { RequestArtifactReference } from "../request-envelope/types";

/**
 * Path-like tokens after `@`, excluding obvious non-path mentions.
 * Does not load file content — paths only.
 */
const MENTION_PATH =
  /(?<![\w/])@(?:"([^"\n]+)"|'([^'\n]+)'|([^\s,;)\]}>]+))/g;

const LINE_RANGE_SUFFIX = /:(\d+)(?:-(\d+))?$/;

/** Whole-message bare path / drag-drop (optional quotes). */
const BARE_PATH_MESSAGE =
  /^(?:["']([^"'\n]+)["']|((?:[~.]?\/)?[\w.@+-]+(?:\/[\w.@+-]+)+(?:\/)?|(?:[\w.@+-]+\.[\w.+-]+))(?::(\d+)(?:-(\d+))?)?)$/;

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

function toArtifact(
  rawPath: string,
  startLine?: number,
  endLine?: number,
): RequestArtifactReference | undefined {
  const path = rawPath.replace(/\\/g, "/").replace(/\/$/, "") || rawPath;
  if (!path) {
    return undefined;
  }

  const kind =
    startLine !== undefined
      ? "selection"
      : path.endsWith("/")
        ? "folder"
        : "file";

  return {
    name: basename(path),
    path,
    kind,
    ...(startLine !== undefined ? { startLine } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
  };
}

function parsePathWithOptionalRange(raw: string): {
  path: string;
  startLine?: number;
  endLine?: number;
} {
  let path = raw;
  let startLine: number | undefined;
  let endLine: number | undefined;

  const range = LINE_RANGE_SUFFIX.exec(raw);
  if (range) {
    path = raw.slice(0, range.index);
    startLine = Number.parseInt(range[1] ?? "", 10);
    endLine = range[2] ? Number.parseInt(range[2], 10) : startLine;
    if (!Number.isFinite(startLine) || (startLine ?? 0) <= 0) {
      startLine = undefined;
      endLine = undefined;
      path = raw;
    }
  }

  return { path, startLine, endLine };
}

/**
 * When the entire message is a single path (drag/drop or paste),
 * promote it to a referenced artifact. Image extensions stay `file`
 * stubs — hosts may also attach binary via `attachments`.
 */
export function extractBarePathArtifact(
  message: string,
): RequestArtifactReference | undefined {
  const trimmed = message.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.startsWith("/")) {
    // Leading `/` alone is a slash command surface; absolute Unix paths
    // that are not commands still match BARE_PATH via `~/` or `/Users/…`
    // only when they have a path signal below.
  }

  // Absolute paths: /Users/.../file.ts or ~/proj/a.ts
  const absolute =
    /^(~|\/)(?:[\w.@+-]+\/)+[\w.@+-]+(?:\.[A-Za-z0-9_+-]+)?(?::(\d+)(?:-(\d+))?)?$/.exec(
      trimmed,
    );
  if (absolute) {
    const rangeStart = absolute[2]
      ? Number.parseInt(absolute[2], 10)
      : undefined;
    const rangeEnd = absolute[3]
      ? Number.parseInt(absolute[3], 10)
      : rangeStart;
    return toArtifact(absolute[0].replace(/:\d+(?:-\d+)?$/, ""), rangeStart, rangeEnd);
  }

  const match = BARE_PATH_MESSAGE.exec(trimmed);
  if (!match) {
    return undefined;
  }

  const raw = (match[1] ?? match[2] ?? "").trim();
  if (!raw) {
    return undefined;
  }

  const startLine = match[3] ? Number.parseInt(match[3], 10) : undefined;
  const endLine = match[4]
    ? Number.parseInt(match[4], 10)
    : startLine;

  // Single-segment names need an extension (README.md, foo.ts) — already
  // required by BARE_PATH_MESSAGE. Skip command-like tokens.
  if (raw.startsWith("/") && !raw.includes("/", 1)) {
    return undefined;
  }

  const { path, startLine: parsedStart, endLine: parsedEnd } =
    startLine !== undefined
      ? { path: raw, startLine, endLine }
      : parsePathWithOptionalRange(raw);

  return toArtifact(path, parsedStart, parsedEnd);
}

/**
 * Extract `@path` / `@path:line` / `@path:start-end` mentions into
 * referenced artifact stubs. Mentions remain in the message text.
 * Also promotes a whole-message bare path / file drop.
 */
export function extractMentionArtifacts(
  message: string,
): RequestArtifactReference[] {
  const artifacts: RequestArtifactReference[] = [];
  const seen = new Set<string>();

  const push = (artifact: RequestArtifactReference | undefined) => {
    if (!artifact) {
      return;
    }
    const key = artifactKey(artifact);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    artifacts.push(artifact);
  };

  for (const match of message.matchAll(MENTION_PATH)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) {
      continue;
    }

    const hasPathSignal =
      raw.includes("/") ||
      raw.includes("\\") ||
      raw.includes(".") ||
      raw.includes(":");
    if (!hasPathSignal) {
      continue;
    }

    const { path, startLine, endLine } = parsePathWithOptionalRange(raw);
    push(toArtifact(path, startLine, endLine));
  }

  // Bare path / drag-drop when the message is only a path.
  if (artifacts.length === 0) {
    push(extractBarePathArtifact(message));
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
