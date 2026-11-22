import { CHUNKING_ERRORS, CHUNKING_PATTERNS } from "./constants";
import type { ChunkingInput } from "./types";

export function validateChunkingHash(hash: string): void {
  if (!CHUNKING_PATTERNS.CONTENT_HASH.test(hash)) {
    throw new TypeError(CHUNKING_ERRORS.HASH_INVALID);
  }
}

export function validateChunkingInput(input: ChunkingInput): void {
  if (!input.sourceId.trim()) {
    throw new TypeError(CHUNKING_ERRORS.SOURCE_ID_REQUIRED);
  }

  if (!input.rootId.trim()) {
    throw new TypeError(CHUNKING_ERRORS.ROOT_ID_REQUIRED);
  }

  const relativePath = input.relativePath;

  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.endsWith("/") ||
    relativePath.includes("\\") ||
    relativePath
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError(CHUNKING_ERRORS.RELATIVE_PATH_REQUIRED);
  }

  if (input.contentHash) {
    validateChunkingHash(input.contentHash);
  }
}
