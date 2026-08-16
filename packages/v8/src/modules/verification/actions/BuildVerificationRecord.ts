import { compareRepoBuildStates } from "./CompareRepoBuildStates";
import { VERIFICATION_RECORD_SCHEMA_VERSION } from "../constants";
import { verificationRecordSchema } from "../contracts";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationRecord,
  VerificationRecordReasonCode,
  VerificationRecordStatus,
  VerificationResult,
} from "../contracts";

export interface BuildVerificationRecordParams {
  runId: string;
  requestId: string;
  workspaceId?: string;
  recordId?: string;
  capturedAt?: string;
  updatedAt?: string;
  status: VerificationRecordStatus;
  before?: RepoBuildState;
  after?: RepoBuildState;
  comparison?: RepoBuildStateComparison;
  verification?: VerificationResult;
  changedFiles?: readonly string[];
  userSummary?: string;
  reasonCodes?: readonly VerificationRecordReasonCode[];
}

const STATUS_REASON: Record<
  VerificationRecordStatus,
  VerificationRecordReasonCode
> = {
  captured_before: "record_captured_before",
  compared: "record_compared",
  passed: "record_passed",
  incomplete: "record_incomplete",
  cancelled: "record_cancelled",
};

/**
 * Assemble a validated durable verification record from before/after evidence.
 * Comparison is derived when both snapshots exist and the caller omitted one.
 */
export function buildVerificationRecord(
  params: BuildVerificationRecordParams,
): VerificationRecord {
  const now = params.updatedAt ?? params.capturedAt ?? new Date().toISOString();
  const recordId = params.recordId ?? params.runId;
  const comparison =
    params.comparison ??
    (params.after
      ? compareRepoBuildStates({
          before: params.before,
          after: params.after,
        })
      : undefined);
  const checkIds = uniqueStrings([
    ...(params.before?.checks ?? []).map((check) => check.checkId),
    ...(params.after?.checks ?? []).map((check) => check.checkId),
    ...(params.verification?.checks ?? []).map((check) => check.checkId),
  ]).slice(0, 64);

  const reasonCodes = uniqueReasons([
    STATUS_REASON[params.status],
    ...(params.reasonCodes ?? []),
    ...(params.status === "incomplete" ? (["retry_available"] as const) : []),
  ]);

  return verificationRecordSchema.parse({
    schemaVersion: VERIFICATION_RECORD_SCHEMA_VERSION,
    recordId,
    runId: params.runId,
    requestId: params.requestId,
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    capturedAt: params.capturedAt ?? now,
    updatedAt: now,
    status: params.status,
    ...(params.before ? { before: params.before } : {}),
    ...(params.after ? { after: params.after } : {}),
    ...(comparison ? { comparison } : {}),
    ...(params.verification ? { verification: params.verification } : {}),
    changedFiles: uniqueStrings(params.changedFiles ?? []).slice(0, 200),
    checkIds,
    ...(params.userSummary && params.userSummary.trim().length > 0
      ? { userSummary: params.userSummary.trim().slice(0, 4_000) }
      : {}),
    ...(params.status === "incomplete"
      ? { retry: { kind: "fix_remaining" as const, recordId } }
      : {}),
    reasonCodes,
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueReasons(
  values: readonly VerificationRecordReasonCode[],
): VerificationRecordReasonCode[] {
  return [...new Set(values)];
}
