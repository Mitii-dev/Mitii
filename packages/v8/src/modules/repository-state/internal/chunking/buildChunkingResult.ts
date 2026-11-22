import { CHUNKING_MESSAGES, CHUNKING_SCHEMA_VERSION } from "./constants";
import { chunkingResultSchema } from "./schema";
import type {
  ChunkingInput,
  ChunkingResult,
  ChunkingStatus,
  ChunkingWarning,
} from "./types";

export interface BuildChunkingResultInput {
  input: ChunkingInput;
  sourceContentHash: string;
  status: ChunkingStatus;
  processedCharacters: number;
  inputCharacters: number;
  inputLines: number;
  chunks: ChunkingResult["chunks"];
  warnings: ChunkingWarning[];
  strategyId?: string;
}

export function buildChunkingResult(
  params: BuildChunkingResultInput,
): ChunkingResult {
  const language =
    params.input.language || params.input.sourceAnalysis?.language;

  const result: ChunkingResult = {
    schemaVersion: CHUNKING_SCHEMA_VERSION,
    sourceId: params.input.sourceId,
    rootId: params.input.rootId,
    relativePath: params.input.relativePath,
    ...(language ? { language } : {}),
    sourceContentHash: params.sourceContentHash,
    ...(params.strategyId ? { strategyId: params.strategyId } : {}),
    status: params.status,
    chunks: params.chunks,
    warnings: params.warnings,
    statistics: {
      inputCharacters: params.inputCharacters,
      processedCharacters: params.processedCharacters,
      omittedCharacters: params.inputCharacters - params.processedCharacters,
      inputLines: params.inputLines,
      emittedChunks: params.chunks.length,
      estimatedTokens: params.chunks.reduce(
        (sum, chunk) => sum + chunk.tokenEstimate,
        0,
      ),
    },
  };

  return chunkingResultSchema.parse(result) as ChunkingResult;
}

export function resolveChunkingSourceAnalysis(
  input: ChunkingInput,
  warnings: ChunkingWarning[],
) {
  const analysis = input.sourceAnalysis;

  if (!analysis) {
    return undefined;
  }

  if (
    analysis.sourceId !== input.sourceId ||
    analysis.rootId !== input.rootId ||
    analysis.relativePath !== input.relativePath
  ) {
    warnings.push({
      code: "source_analysis_mismatch",
      message: CHUNKING_MESSAGES.SOURCE_ANALYSIS_MISMATCH,
    });

    return undefined;
  }

  return analysis;
}

export function safeChunkingPrefix(
  content: string,
  maximumCharacters: number,
): string {
  let end = maximumCharacters;

  const character = content.charCodeAt(end - 1);

  if (character >= 0xd800 && character <= 0xdbff) {
    end -= 1;
  }

  return content.slice(0, end);
}

export function chunkingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
