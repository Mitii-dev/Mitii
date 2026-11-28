/** Runtime package identity + schema markers. */

export const RUNTIME_SCHEMA_VERSION = 1 as const;

/** Re-export grant profile ids — owner remains decision-policy. */
export {
  GRANT_PROFILES,
  type GrantProfile,
} from "../modules/decision-policy";

export const RUNTIME_REASON_CODES = {
  not_implemented: "runtime_not_implemented",
  store_missing: "runtime_store_missing",
  cancel_requested: "runtime_cancel_requested",
} as const;

export type RuntimeReasonCode =
  (typeof RUNTIME_REASON_CODES)[keyof typeof RUNTIME_REASON_CODES];
