/**
 * Public factories for durable verification records.
 * Implementation lives in actions/; this file is the supported facade.
 */
export { buildVerificationRecord } from "./actions/BuildVerificationRecord";
export type { BuildVerificationRecordParams } from "./actions/BuildVerificationRecord";
export { buildVerificationUserSummary } from "./actions/BuildVerificationUserSummary";
