/**
 * Public ignore-policy surface for repository-state.
 * Implementation lives under internal/; this facade keeps the module barrel clean.
 */
export { WorkspaceIgnorePolicy } from "./internal/workspace/utils/ws-ignore-policy/WorkspaceIgnorePolicy";
export { isSecurityConcern } from "./internal/workspace/utils/ws-ignore-policy/isSecurityConcern";
export { WS_CONSTANTS } from "./internal/workspace/constants";
export type {
  WorkspaceIgnoreDecision,
  WorkspaceIgnorePolicyOptions,
  WorkspaceIgnoreReason,
} from "./internal/workspace/types";
