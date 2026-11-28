/**
 * @mitii/sandbox — OS process isolation for Mitii hosts.
 *
 * Package (not a V8 module): seatbelt / bubblewrap / docker|podman,
 * ephemeral + session lifecycle, grant→OS projection.
 * Hosts supply ProcessPort + optional SandboxLoggerPort and safety overlays.
 */

export {
  SANDBOX_REASON_CODES,
  SANDBOX_LIFECYCLE_MODES,
  SANDBOX_ISOLATION_PROFILES,
  SANDBOX_IMAGE_CANDIDATES,
  DEFAULT_SANDBOX_IMAGE,
  SANDBOX_ENV_KEYS,
  SANDBOX_STRIP_ENV_KEYS,
  SANDBOX_SECRET_ENV_PATTERNS,
  DEFAULT_SANDBOX_RESOURCES,
  DEFAULT_SESSION_READY,
  DEFAULT_SESSION_POOL,
  SESSION_CONTAINER_KEEPALIVE,
} from './constants.js';
export type {
  SandboxReasonCode,
  SandboxLifecycleMode,
} from './constants.js';

export {
  sandboxNetworkModeSchema,
  sandboxIsolationProfileSchema,
  sandboxBackendIdSchema,
  sandboxBackendPreferSchema,
  sandboxResourcesSchema,
  sandboxPolicySchema,
  resolveSandboxPolicy,
  resolveSandboxResources,
  SandboxUnavailableError,
  formatSandboxFailClosed,
} from './contracts/index.js';
export type {
  SandboxNetworkMode,
  SandboxIsolationProfile,
  SandboxBackendId,
  SandboxBackendPrefer,
  SandboxResources,
  SandboxPolicy,
  SandboxBackend,
} from './contracts/index.js';

export {
  resolveSandboxPreset,
  resolveSandboxSettingsFromPreset,
} from './defaults.js';
export type {
  SandboxApprovalPreset,
  SandboxPresetDefaults,
} from './defaults.js';

export {
  noopSandboxLogger,
  type SandboxLoggerPort,
} from './ports/index.js';

export {
  buildSandboxPolicy,
  SANDBOX_DEFAULT_DENY_READ_RELATIVE,
  projectGrantToOsPolicy,
  type BuildSandboxPolicyInput,
  type SandboxGrantScopesInput,
} from './policy/index.js';

export {
  detectSandboxBackend,
  createSandboxedProcessPort,
  createSandboxProcessPort,
  createHostSandboxProcessPort,
  isSessionSandboxedProcessPort,
  disposeSandboxProcessPort,
  probeSandboxReadiness,
  describeSandboxPort,
  type CreateSandboxedProcessPortOptions,
  type CreateSandboxProcessPortOptions,
  type CreateHostSandboxProcessPortOptions,
  type SandboxedProcessPort,
  type SandboxReadiness,
  type SandboxPortDescription,
} from './process/index.js';

export { resolveDockerBackend } from './adapters/docker/index.js';
export { resolveSeatbeltBackend } from './adapters/seatbelt/index.js';
export { resolveBubblewrapBackend } from './adapters/bubblewrap/index.js';
export { resolveWindowsBackend } from './adapters/windows/index.js';
export {
  toContainerPath,
  toVolumeSpec,
  mapCwdToContainer,
} from './helpers/containerPaths.js';

export {
  createLiveSandboxedProcessPort,
  type LiveSandboxSettings,
  type LiveSandboxSettingsReader,
  type LiveSandboxPolicyOptions,
} from './live/index.js';

export {
  createSessionSandboxedProcessPort,
  createContainerCli,
  detectSessionContainerRuntime,
  buildSessionContainerName,
  SessionContainer,
  SessionSandboxPool,
  waitUntilSessionRunning,
  sandboxLifecycleModeSchema,
  sandboxSessionStatusSchema,
} from './lifecycle/index.js';
export type {
  SessionSandboxedProcessPort,
  CreateSessionSandboxedProcessPortOptions,
  ContainerCli,
  SandboxSessionStatus,
  SandboxSessionInfo,
  ContainerRuntimeKind,
  SessionSandboxPoolOptions,
  WaitUntilRunningOptions,
} from './lifecycle/index.js';
