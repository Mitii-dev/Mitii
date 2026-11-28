import {
  CONTEXT_ASSEMBLY_MESSAGES,
} from "./constants";

import {
  buildDroppedBlock,
  describeLoadFailure,
  markRequiredOmitted,
} from "./contextAssemblyDrops";

import type {
  ContextBlockBuilder,
} from "./ContextBlockBuilder";

import type {
  ContextContentLoader,
} from "./ContextContentLoader";

import type {
  ContextSecretRedactor,
} from "./ContextSecretRedactor";

import type {
  ContextSensitivePathPolicy,
} from "./ContextSensitivePathPolicy";

import type {
  ContextTextSanitizer,
} from "./ContextTextSanitizer";

import type {
  ContextTextTruncator,
} from "./ContextTextTruncator";

import type {
  ContextAssemblyInput,
  ContextAssemblyWarning,
  ContextBlock,
  DroppedContextBlock,
  ResolvedContextAssemblerOptions,
} from "./types";

import type {
  SelectedContextItem,
} from "../context-selection/types";

export interface ContextItemAssemblyDependencies {
  readonly options: ResolvedContextAssemblerOptions;
  readonly contentLoader: ContextContentLoader;
  readonly textTruncator: ContextTextTruncator;
  readonly sensitivePathPolicy: ContextSensitivePathPolicy;
  readonly textSanitizer: ContextTextSanitizer;
  readonly secretRedactor: ContextSecretRedactor;
  readonly blockBuilder: ContextBlockBuilder;
}

/** Mutable accumulator shared across the per-item assembly loop. */
export interface ContextAssemblyRunState {
  readonly warnings: ContextAssemblyWarning[];
  readonly dropped: DroppedContextBlock[];
  readonly blocks: ContextBlock[];
  readonly seenBlockIds: Set<string>;
  attemptedItems: number;
  inputCharacters: number;
  requiredOmitted: boolean;
}

export function createContextAssemblyRunState(): ContextAssemblyRunState {
  return {
    warnings: [],
    dropped: [],
    blocks: [],
    seenBlockIds: new Set<string>(),
    attemptedItems: 0,
    inputCharacters: 0,
    requiredOmitted: false,
  };
}

/**
 * Loads, sanitizes, redacts, truncates and builds a block for one selected
 * item, recording warnings and drops on `state`. Returns `"cancelled"` when
 * the load was cancelled; the caller then emits the terminal result.
 */
export async function assembleContextItem(
  deps: ContextItemAssemblyDependencies,
  input: ContextAssemblyInput,
  item: SelectedContextItem,
  state: ContextAssemblyRunState,
): Promise<"done" | "cancelled"> {
  const { options } = deps;
  const { warnings, dropped } = state;
  const omitRequired = (): void => {
    state.requiredOmitted =
      markRequiredOmitted(item, warnings) || state.requiredOmitted;
  };

  const sensitive = deps.sensitivePathPolicy.evaluate(item.relativePath);

  if (sensitive.sensitive && options.sensitivePathMode === "block") {
    dropped.push(
      buildDroppedBlock(
        item,
        "sensitive_path",
        `${CONTEXT_ASSEMBLY_MESSAGES.SENSITIVE_PATH_BLOCKED} Rule: ${sensitive.matchedRule ?? "sensitive-path"}.`,
      ),
    );
    warnings.push({
      code: "sensitive_path_blocked",
      message: CONTEXT_ASSEMBLY_MESSAGES.SENSITIVE_PATH_BLOCKED,
      selectionKey: item.key,
      relativePath: item.relativePath,
    });
    omitRequired();
    return "done";
  }

  const loadResult = await deps.contentLoader.load({
    item,
    snapshot: input.snapshot,
    maximumBytes: options.maximumBytesPerItem,
    allowRepresentationFallback: options.allowRepresentationFallback,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });

  if (loadResult.status === "cancelled") {
    return "cancelled";
  }

  if (loadResult.status !== "loaded" || !loadResult.loaded) {
    const failure = describeLoadFailure(item, loadResult);
    dropped.push(failure.drop);
    warnings.push(...failure.warnings);
    omitRequired();
    return "done";
  }

  const loaded = loadResult.loaded;
  const locator = {
    selectionKey: item.key,
    relativePath: item.relativePath,
    sourceId: loaded.sourceId,
  };
  state.inputCharacters += loaded.content.length;

  for (const failedAttempt of loadResult.attempts.filter(
    (attempt) => attempt.status === "failed",
  )) {
    warnings.push({
      code: "content_source_failed",
      message:
        `${CONTEXT_ASSEMBLY_MESSAGES.CONTENT_SOURCE_FAILED} ${failedAttempt.message}`,
      selectionKey: item.key,
      relativePath: item.relativePath,
      sourceId: failedAttempt.sourceId,
    });
  }

  if (loaded.fallbackUsed) {
    warnings.push({
      code: "representation_fallback",
      message: CONTEXT_ASSEMBLY_MESSAGES.REPRESENTATION_FALLBACK,
      ...locator,
    });
  }

  const sanitized = deps.textSanitizer.sanitize(loaded.content);

  if (sanitized.removedControlCharacters > 0) {
    warnings.push({
      code: "content_sanitized",
      message: CONTEXT_ASSEMBLY_MESSAGES.CONTENT_SANITIZED,
      count: sanitized.removedControlCharacters,
      ...locator,
    });
  }

  const redaction = options.redactSecrets
    ? deps.secretRedactor.redact(sanitized.content)
    : { content: sanitized.content, redactions: [] };

  if (redaction.redactions.length > 0) {
    warnings.push({
      code: "secrets_redacted",
      message: CONTEXT_ASSEMBLY_MESSAGES.SECRETS_REDACTED,
      count: redaction.redactions.reduce(
        (sum, current) => sum + current.count,
        0,
      ),
      ...locator,
    });
  }

  if (!redaction.content.trim()) {
    dropped.push(
      buildDroppedBlock(
        item,
        "empty_content",
        CONTEXT_ASSEMBLY_MESSAGES.EMPTY_CONTENT,
      ),
    );
    warnings.push({
      code: "empty_content",
      message: CONTEXT_ASSEMBLY_MESSAGES.EMPTY_CONTENT,
      ...locator,
    });
    omitRequired();
    return "done";
  }

  const truncated = deps.textTruncator.truncate({
    content: redaction.content,
    maximumTokens: item.allocatedTokens,
    representation: loaded.representation,
    ...(loaded.startLine !== undefined
      ? { startLine: loaded.startLine }
      : {}),
    ...(loaded.endLine !== undefined ? { endLine: loaded.endLine } : {}),
  });

  if (truncated.truncated) {
    warnings.push({
      code: "content_truncated",
      message: CONTEXT_ASSEMBLY_MESSAGES.CONTENT_TRUNCATED,
      ...locator,
    });
  }

  const block = deps.blockBuilder.build({
    item,
    loaded,
    content: truncated.content,
    tokenEstimate: truncated.tokenEstimate,
    lineRanges: truncated.lineRanges,
    truncated: truncated.truncated,
    omittedCharacters: truncated.omittedCharacters,
    redactions: redaction.redactions,
  });

  if (state.seenBlockIds.has(block.id)) {
    dropped.push(
      buildDroppedBlock(
        item,
        "duplicate_block",
        CONTEXT_ASSEMBLY_MESSAGES.DUPLICATE_BLOCK_REMOVED,
      ),
    );
    warnings.push({
      code: "duplicate_block_removed",
      message: CONTEXT_ASSEMBLY_MESSAGES.DUPLICATE_BLOCK_REMOVED,
      ...locator,
    });
    return "done";
  }

  state.seenBlockIds.add(block.id);
  state.blocks.push(block);
  return "done";
}
