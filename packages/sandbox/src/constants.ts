/** Stable reason codes for OS sandbox failures (host boundary). */
export const SANDBOX_REASON_CODES = [
  'sandbox_unavailable',
  'sandbox_disabled',
  'backend_missing',
  'wrap_failed',
  'session_unavailable',
  'session_not_running',
  'session_destroy_failed',
] as const;

export type SandboxReasonCode = (typeof SANDBOX_REASON_CODES)[number];

export const SANDBOX_LIFECYCLE_MODES = ['ephemeral', 'session'] as const;
export type SandboxLifecycleMode = (typeof SANDBOX_LIFECYCLE_MODES)[number];

/**
 * Isolation tightness.
 * - strict: minimal FS reads (highest security, more tool breakage risk)
 * - balanced (default): compatible FS + still write/network fenced (best success rate)
 * - permissive: write/network fences only (debug / trusted runs)
 */
export const SANDBOX_ISOLATION_PROFILES = [
  'strict',
  'balanced',
  'permissive',
] as const;
export type SandboxIsolationProfile =
  (typeof SANDBOX_ISOLATION_PROFILES)[number];

/**
 * Image preference order when `MITII_SANDBOX_IMAGE` is unset.
 * Prefer a Mitii-tagged image, then a Node-capable slim image, then alpine.
 */
export const SANDBOX_IMAGE_CANDIDATES = [
  'mitii-sandbox:local',
  'node:20-bookworm-slim',
  'alpine:3.20',
] as const;

/** Default container image when prefer is docker/podman and env is unset. */
export const DEFAULT_SANDBOX_IMAGE = SANDBOX_IMAGE_CANDIDATES[2];

/** Keepalive command for long-lived session containers. */
export const SESSION_CONTAINER_KEEPALIVE = [
  'sleep',
  'infinity',
] as const;

/** Env keys the host sandbox contract reads. */
export const SANDBOX_ENV_KEYS = {
  enabled: 'MITII_SANDBOX',
  network: 'MITII_SANDBOX_NETWORK',
  backend: 'MITII_SANDBOX_BACKEND',
  image: 'MITII_SANDBOX_IMAGE',
  memory: 'MITII_SANDBOX_MEMORY',
  cpus: 'MITII_SANDBOX_CPUS',
  pidsLimit: 'MITII_SANDBOX_PIDS_LIMIT',
  lifecycle: 'MITII_SANDBOX_LIFECYCLE',
  profile: 'MITII_SANDBOX_PROFILE',
} as const;

/** Loader / injection env vars stripped before a sandboxed spawn. */
export const SANDBOX_STRIP_ENV_KEYS = [
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'DYLD_FALLBACK_FRAMEWORK_PATH',
] as const;

/**
 * Glob-style secret patterns stripped in strict/balanced profiles
 * (`*` = prefix/suffix/contains). Case-insensitive.
 */
export const SANDBOX_SECRET_ENV_PATTERNS = [
  '*_API_KEY',
  '*_TOKEN',
  '*_SECRET',
  '*_PASSWORD',
  '*_PASS',
  'AWS_*',
  'AZURE_*',
  'GCP_*',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'KUBE*',
  'K8S_*',
  'OPENAI_*',
  'ANTHROPIC_*',
  'GEMINI_*',
  'MITII_API_KEY',
  'MITII_ANTHROPIC_API_KEY',
  'MITII_GEMINI_API_KEY',
] as const;

export const DEFAULT_SANDBOX_RESOURCES = {
  memory: '512m',
  cpus: '1',
  pidsLimit: 256,
} as const;

/** Session readiness poll defaults (success-rate). */
export const DEFAULT_SESSION_READY = {
  timeoutMs: 30_000,
  pollIntervalMs: 200,
  maxAttempts: 150,
} as const;

/** Warm pool defaults (speed). */
export const DEFAULT_SESSION_POOL = {
  maxIdle: 2,
  acquireTimeoutMs: 30_000,
} as const;
