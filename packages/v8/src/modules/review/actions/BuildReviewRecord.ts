import {
  REVIEW_RECORD_SCHEMA_VERSION,
} from "../constants";
import type {
  ReviewParsedInput,
  ReviewPrepResult,
  ReviewRecord,
  ReviewResult,
} from "../contracts";
import { reviewRecordSchema } from "../contracts";
import { fingerprintGroup } from "../internal/pathUtils";

export function buildReviewRecord(params: {
  input: ReviewParsedInput;
  prep?: ReviewPrepResult;
  result?: ReviewResult;
  recordId: string;
  status: ReviewRecord["status"];
  now?: Date;
}): ReviewRecord {
  const now = (params.now ?? new Date()).toISOString();
  const groupFingerprints =
    params.prep?.groups.map((g) => fingerprintGroup(g.paths)) ??
    params.result?.groups.map((g) => fingerprintGroup(g.paths)) ??
    [];

  const reasonCodes =
    params.result?.reasonCodes ??
    params.prep?.reasonCodes ??
    (["review_prepared"] as const);

  return reviewRecordSchema.parse({
    schemaVersion: REVIEW_RECORD_SCHEMA_VERSION,
    recordId: params.recordId,
    runId: params.input.runId,
    requestId: params.input.requestId,
    workspaceId: params.input.workspaceId,
    capturedAt: now,
    updatedAt: now,
    status: params.status,
    mode: params.input.mode,
    effort: params.input.effort,
    fromRef: params.input.fromRef,
    toRef: params.input.toRef,
    commit: params.input.commit,
    mergeBase: params.input.mergeBase,
    prep: params.prep,
    result: params.result,
    groupFingerprints,
    userSummary: params.result?.userSummary,
    reasonCodes: [...reasonCodes],
  });
}
