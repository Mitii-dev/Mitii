/**
 * Build + persist verification records.
 */
import { buildVerificationRecord } from "../../../modules/verification";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationRecord,
  VerificationRecordStatus,
  VerificationResult,
} from "../../../modules/verification";

import type { AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import { describeCaughtError } from "../internal/describeCaughtError";
import type { AgentEngineRuntime } from "./runtime";

export async function persistVerificationArtifact(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    requestId: string;
    workspaceId?: string;
    bus: EventBus;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    status: VerificationRecordStatus;
    before?: RepoBuildState;
    after?: RepoBuildState;
    comparison?: RepoBuildStateComparison;
    verification?: VerificationResult;
    changedFiles?: readonly string[];
    userSummary?: string;
    previous?: VerificationRecord;
    logVerbosity: AgentLogVerbosity;
  },
): Promise<VerificationRecord | undefined> {
  if (!params.before && !params.after && !params.verification) {
    return params.previous;
  }
  let record: VerificationRecord;
  try {
    record = buildVerificationRecord({
      runId: params.runId,
      requestId: params.requestId,
      workspaceId: params.workspaceId,
      recordId: params.previous?.recordId ?? params.runId,
      capturedAt: params.previous?.capturedAt,
      status: params.status,
      before: params.before ?? params.previous?.before,
      after: params.after ?? params.previous?.after,
      comparison: params.comparison ?? params.previous?.comparison,
      verification: params.verification ?? params.previous?.verification,
      changedFiles: params.changedFiles ?? params.previous?.changedFiles,
      userSummary: params.userSummary ?? params.previous?.userSummary,
    });
  } catch (error) {
    const message = `Verification record could not be built: ${describeCaughtError(error)}`;
    params.warnings.push(message);
    params.reasonCodes.push("verification_record_build_failed");
    if (logVerbosityAtLeast(params.logVerbosity, "standard")) {
      runtime.emit(params.bus, {
        type: "warning",
        runId: params.runId,
        message,
        code: "verification_record_build_failed",
        at: runtime.isoNow(),
      });
    }
    return params.previous;
  }

  if (runtime.deps.verification?.persistRecord) {
    try {
      await runtime.deps.verification.persistRecord(record);
      params.reasonCodes.push("verification_record_saved");
      runtime.emit(params.bus, {
        type: "verification_record_saved",
        runId: params.runId,
        recordId: record.recordId,
        status: record.status,
        retryAvailable: Boolean(record.retry),
        at: runtime.isoNow(),
      });
    } catch (error) {
      params.warnings.push(
        `Verification record persist failed: ${describeCaughtError(error)}`,
      );
    }
  }

  return record;
}
