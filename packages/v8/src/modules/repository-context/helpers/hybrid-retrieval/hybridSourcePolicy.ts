import { HYBRID_RETRIEVAL_MESSAGES } from "./constants";
import { SoftSourceTimeoutError } from "./SoftSourceTimeoutError";

import type {
  HybridRetrievalWarning,
  ResolvedHybridRetrieverOptions,
  RetrievalSourceExecutionResult,
} from "./types";

type PolicyOptions = Pick<
  ResolvedHybridRetrieverOptions,
  "failureMode" | "minimumSuccessfulSources"
>;

function isSuccessfulStatus(execution: RetrievalSourceExecutionResult): boolean {
  return (
    execution.report.status === "complete" ||
    execution.report.status === "empty"
  );
}

export function collectSourceWarnings(
  executions: readonly RetrievalSourceExecutionResult[],
  warnings: HybridRetrievalWarning[],
): void {
  for (const execution of executions) {
    const sourceId = execution.registration.source.id;

    if (execution.report.status === "failed") {
      const timedOut = execution.error instanceof SoftSourceTimeoutError;
      warnings.push({
        code: timedOut ? "source_timeout" : "source_failed",
        message: timedOut
          ? HYBRID_RETRIEVAL_MESSAGES.SOURCE_TIMEOUT
          : HYBRID_RETRIEVAL_MESSAGES.SOURCE_FAILED,
        sourceId,
      });
    }

    if (
      execution.report.status === "skipped" &&
      execution.error instanceof SoftSourceTimeoutError
    ) {
      warnings.push({
        code: "source_timeout",
        message: HYBRID_RETRIEVAL_MESSAGES.SOURCE_TIMEOUT,
        sourceId,
      });
    }

    if (
      execution.registration.required &&
      execution.report.status === "skipped"
    ) {
      warnings.push({
        code: "required_source_unavailable",
        message: HYBRID_RETRIEVAL_MESSAGES.REQUIRED_SOURCE_UNAVAILABLE,
        sourceId,
      });
    }

    if (execution.report.truncated) {
      warnings.push({
        code: "source_truncated",
        message: HYBRID_RETRIEVAL_MESSAGES.SOURCE_TRUNCATED,
        sourceId,
      });
    }
  }
}

export function policySatisfied(
  executions: readonly RetrievalSourceExecutionResult[],
  options: PolicyOptions,
): boolean {
  const successfulCount = executions.filter(isSuccessfulStatus).length;

  if (successfulCount < options.minimumSuccessfulSources) {
    return false;
  }

  if (options.failureMode === "all_sources") {
    return executions.every(isSuccessfulStatus);
  }

  if (options.failureMode === "required_sources") {
    return executions.every(
      (execution) =>
        !execution.registration.required || isSuccessfulStatus(execution),
    );
  }

  return true;
}

export function addPolicyWarning(
  executions: readonly RetrievalSourceExecutionResult[],
  warnings: HybridRetrievalWarning[],
  options: PolicyOptions,
): void {
  const successfulCount = executions.filter(isSuccessfulStatus).length;

  if (successfulCount < options.minimumSuccessfulSources) {
    warnings.push({
      code: "minimum_sources_unsatisfied",
      message: HYBRID_RETRIEVAL_MESSAGES.MINIMUM_SOURCES_UNSATISFIED,
    });
    return;
  }

  warnings.push({
    code: "failure_policy_unsatisfied",
    message: HYBRID_RETRIEVAL_MESSAGES.FAILURE_POLICY_UNSATISFIED,
  });
}
