/**
 * Public ignore-policy surface for repository-state.
 * Implementation lives under helpers/workspace; this facade keeps the barrel clean.
 */
export { WorkspaceIgnorePolicy } from "./workspace/utils/ws-ignore-policy/WorkspaceIgnorePolicy";
export { isSecurityConcern } from "./workspace/utils/ws-ignore-policy/isSecurityConcern";
export { WS_CONSTANTS } from "./workspace/constants";
export type {
  WorkspaceIgnoreDecision,
  WorkspaceIgnorePolicyOptions,
  WorkspaceIgnoreReason,
} from "./workspace/types";
