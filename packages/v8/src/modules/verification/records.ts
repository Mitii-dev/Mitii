/**
 * Public factories for durable verification records.
 * Implementation lives in flow/steps/; this file is the supported facade.
 */
export { buildVerificationRecord } from "./flow/steps/9-build-record";
export type { BuildVerificationRecordParams } from "./flow/steps/9-build-record";
export {
  buildVerificationUserSummary,
  formatOptionalLeftoverOffer,
} from "./flow/steps/10-build-user-summary";
