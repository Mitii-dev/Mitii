import {
  executeCodeNavigationOperation,
  prepareCodeNavigationDocument,
  providerFailureResult,
  resolveCodeNavigationPort,
} from "./steps";
import {
  CODE_NAVIGATION_MESSAGES,
  CODE_NAVIGATION_STAGES,
} from "../constants";
import {
  CodeNavigationError,
  codeNavigationInputSchema,
  noopModuleLogger,
} from "../types";
import type {
  CodeNavigationCallOptions,
  CodeNavigationInput,
  CodeNavigationParsedInput,
  CodeNavigationPort,
  CodeNavigationResult,
  ModuleLoggerPort,
} from "../types";

export interface CodeNavigationPipelineDependencies {
  navigation?: CodeNavigationPort;
  log?: ModuleLoggerPort;
}

/**
 * Resolves definitions, references, and hover via an injected navigation port.
 *
 * Flow (navigate):
 *   1-resolve-port → 2-prepare-document → 3-execute-operation
 *   (+ 4-build-result helpers)
 *
 * Does not spawn language servers or own repository indexing.
 */
export class CodeNavigationPipeline {
  private readonly navigation?: CodeNavigationPort;
  private readonly log: ModuleLoggerPort;

  constructor(
    dependencies: CodeNavigationPipelineDependencies = {},
  ) {
    this.navigation = dependencies.navigation;
    this.log = dependencies.log ?? noopModuleLogger;
  }

  public async navigate(
    input: CodeNavigationInput,
    options: CodeNavigationCallOptions = {},
  ): Promise<CodeNavigationResult> {
    let parsed: CodeNavigationParsedInput;
    try {
      parsed = codeNavigationInputSchema.parse(input);
    } catch (error) {
      throw new CodeNavigationError(
        "invalid_input",
        CODE_NAVIGATION_MESSAGES.navigateInputInvalid,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    let stageStartedMs = Date.now();
    const resolved = resolveCodeNavigationPort({
      port: this.navigation,
      operation: parsed.operation,
    });
    this.log.stage({
      module: "code-navigation",
      stage: CODE_NAVIGATION_STAGES.resolvePort,
      durationMs: Date.now() - stageStartedMs,
      reasonCodes: resolved.ok ? [] : resolved.result.reasonCodes,
      inputSummary: { operation: parsed.operation },
      outputSummary: { ok: resolved.ok },
    });
    if (!resolved.ok) {
      return resolved.result;
    }
    const port = resolved.port;

    try {
      throwIfAborted(options.signal);
      const callOptions: CodeNavigationCallOptions = {
        ...(options.signal ? { signal: options.signal } : {}),
      };

      stageStartedMs = Date.now();
      await prepareCodeNavigationDocument({
        port,
        input: parsed,
        options: callOptions,
      });
      this.log.stage({
        module: "code-navigation",
        stage: CODE_NAVIGATION_STAGES.prepareDocument,
        durationMs: Date.now() - stageStartedMs,
        reasonCodes: [],
        outputSummary: {
          prepared:
            "relativePath" in parsed.query
              ? Boolean(parsed.query.relativePath)
              : false,
        },
      });

      stageStartedMs = Date.now();
      const result = await executeCodeNavigationOperation({
        port,
        input: parsed,
        options: callOptions,
      });
      this.log.stage({
        module: "code-navigation",
        stage: CODE_NAVIGATION_STAGES.executeOperation,
        durationMs: Date.now() - stageStartedMs,
        reasonCodes: result.reasonCodes,
        outputSummary: {
          status: result.status,
          locationCount: result.locations.length,
          truncated: result.truncated,
          provider: result.provider,
        },
      });
      return result;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throw error instanceof Error
          ? error
          : Object.assign(new Error(String(error)), { name: "AbortError" });
      }
      return providerFailureResult({
        operation: parsed.operation,
        port,
        error,
      });
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error(CODE_NAVIGATION_MESSAGES.aborted);
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "RequestLimiterAbortError")
  ) {
    return true;
  }
  return (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}
