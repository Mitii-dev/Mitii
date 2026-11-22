import { CHUNKING_DEFAULTS, CHUNKING_ERRORS } from "./constants";
import type { ChunkingOptions, ResolvedChunkingOptions } from "./types";

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `${name}: ${CHUNKING_ERRORS.POSITIVE_INTEGER_REQUIRED}`,
    );
  }
}

function validateNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${name}: ${CHUNKING_ERRORS.NON_NEGATIVE_INTEGER_REQUIRED}`,
    );
  }
}

export function resolveChunkingOptions(
  options: ChunkingOptions,
): ResolvedChunkingOptions {
  const resolved: ResolvedChunkingOptions = {
    maximumInputCharacters:
      options.maximumInputCharacters ??
      CHUNKING_DEFAULTS.MAXIMUM_INPUT_CHARACTERS,
    inputOverflowPolicy:
      options.inputOverflowPolicy ?? CHUNKING_DEFAULTS.INPUT_OVERFLOW_POLICY,
    targetChunkCharacters:
      options.targetChunkCharacters ??
      CHUNKING_DEFAULTS.TARGET_CHUNK_CHARACTERS,
    maximumChunkCharacters:
      options.maximumChunkCharacters ??
      CHUNKING_DEFAULTS.MAXIMUM_CHUNK_CHARACTERS,
    minimumChunkCharacters:
      options.minimumChunkCharacters ??
      CHUNKING_DEFAULTS.MINIMUM_CHUNK_CHARACTERS,
    overlapCharacters:
      options.overlapCharacters ?? CHUNKING_DEFAULTS.OVERLAP_CHARACTERS,
    boundarySearchCharacters:
      options.boundarySearchCharacters ??
      CHUNKING_DEFAULTS.BOUNDARY_SEARCH_CHARACTERS,
    maximumChunks: options.maximumChunks ?? CHUNKING_DEFAULTS.MAXIMUM_CHUNKS,
    maximumTitleCharacters:
      options.maximumTitleCharacters ??
      CHUNKING_DEFAULTS.MAXIMUM_TITLE_CHARACTERS,
  };

  validatePositiveInteger(
    resolved.maximumInputCharacters,
    "maximumInputCharacters",
  );
  validatePositiveInteger(
    resolved.targetChunkCharacters,
    "targetChunkCharacters",
  );
  validatePositiveInteger(
    resolved.maximumChunkCharacters,
    "maximumChunkCharacters",
  );
  validatePositiveInteger(
    resolved.minimumChunkCharacters,
    "minimumChunkCharacters",
  );
  validateNonNegativeInteger(resolved.overlapCharacters, "overlapCharacters");
  validatePositiveInteger(
    resolved.boundarySearchCharacters,
    "boundarySearchCharacters",
  );
  validatePositiveInteger(resolved.maximumChunks, "maximumChunks");
  validatePositiveInteger(
    resolved.maximumTitleCharacters,
    "maximumTitleCharacters",
  );

  if (resolved.targetChunkCharacters > resolved.maximumChunkCharacters) {
    throw new RangeError(CHUNKING_ERRORS.TARGET_EXCEEDS_MAXIMUM);
  }

  if (resolved.minimumChunkCharacters > resolved.targetChunkCharacters) {
    throw new RangeError(CHUNKING_ERRORS.MINIMUM_EXCEEDS_TARGET);
  }

  if (resolved.overlapCharacters >= resolved.targetChunkCharacters) {
    throw new RangeError(CHUNKING_ERRORS.OVERLAP_TOO_LARGE);
  }

  return resolved;
}
