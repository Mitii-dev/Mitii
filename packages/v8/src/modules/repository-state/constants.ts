/**
 * Stable identifiers for Repository State publication.
 */
export const REPOSITORY_STATE_SCHEMA_VERSION = 1 as const;

export const REPOSITORY_STATE_MESSAGES = {
  invalidCandidate: "Invalid repository state candidate.",
  publicationCancelled: "Repository state publication was cancelled.",
  unknownStateToken: "No published repository state matches the state token.",
  workspaceMismatch: "State token does not belong to the requested workspace.",
  cannotPinUnknown: "Cannot pin an unknown repository state token.",
} as const;

/**
 * Named accessors for frequently logged reason codes.
 * Full catalog remains {@link REPOSITORY_STATE_REASON_CODES}.
 */
export const REPOSITORY_STATE_REASON = {
  scanPartial: "scan_partial",
  capabilityDegraded: "capability_degraded",
  unknownStateToken: "unknown_state_token",
  workspaceMismatch: "workspace_mismatch",
  publicationCancelled: "publication_cancelled",
  statePinned: "state_pinned",
  stateNotFound: "state_not_found",
} as const;

/** Ordered flow stage names (publish path + read/pin/unpin logger). */
export const REPOSITORY_STATE_STAGES = {
  parseCandidate: "1-parse-candidate",
  buildDescriptor: "2-build-descriptor",
  persistDescriptor: "3-persist-descriptor",
  finalizePublish: "4-finalize-publish",
  read: "read",
  pin: "pin",
  unpin: "unpin",
} as const;

export type RepositoryStateStageName =
  (typeof REPOSITORY_STATE_STAGES)[keyof typeof REPOSITORY_STATE_STAGES];

export const REPOSITORY_STATE_READINESS = [
  "ready",
  "degraded",
  "unavailable",
] as const;

export const REPOSITORY_STATE_SCAN_COMPLETENESS = [
  "complete",
  "partial",
  "filtered",
  "truncated",
  "cancelled",
] as const;

export const REPOSITORY_CAPABILITY_IDS = [
  "catalog",
  "codeIndex",
  "textIndex",
  "vectorIndex",
  "graph",
  "map",
] as const;

/** Per-capability levels (ARCHITECTURE § language/capability formula). Descriptor readiness stays `ready|degraded|unavailable`. */
export const REPOSITORY_CAPABILITY_STATUSES = [
  "available",
  "degraded",
  "unavailable",
] as const;

export const REPOSITORY_STATE_REASON_CODES = [
  "scan_partial",
  "scan_filtered",
  "scan_truncated",
  "scan_cancelled",
  "capability_degraded",
  "capability_unavailable",
  "root_incomplete",
  "validation_failed",
  "unknown_state_token",
  "workspace_mismatch",
  "publication_cancelled",
  "concurrent_publication",
  "state_pinned",
  "state_not_found",
] as const;

export const REPOSITORY_STATE_ERROR_CODES = [
  "invalid_candidate",
  "unknown_state_token",
  "workspace_mismatch",
  "publication_cancelled",
  "state_immutable",
  "state_pinned",
  "state_not_found",
] as const;
