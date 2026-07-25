import type {
  ContextRepresentation,
} from "../context-selection/types";

import type {
  ContextSecretPattern,
  ContextTruncationStrategy,
  RequiredContextLoadFailureMode,
  SensitiveContextPathMode,
} from "./types";

export const CONTEXT_ASSEMBLY_SCHEMA_VERSION =
  1 as const;

export const CONTEXT_ASSEMBLY_IDS = {
  ASSEMBLER:
    "context-assembler",
  FACTORY:
    "context-assembly-factory",
  SOURCE_REGISTRY:
    "context-content-source-registry",
  CONTENT_LOADER:
    "context-content-loader",
  WORKSPACE_FILE_SOURCE:
    "workspace-file-context-source",
  SELECTED_PREVIEW_SOURCE:
    "selected-preview-context-source",
  SENSITIVE_PATH_POLICY:
    "context-sensitive-path-policy",
  SECRET_REDACTOR:
    "context-secret-redactor",
  TEXT_SANITIZER:
    "context-text-sanitizer",
  TEXT_TRUNCATOR:
    "context-text-truncator",
  BLOCK_BUILDER:
    "context-block-builder",
  WARNING_AGGREGATOR:
    "context-assembly-warning-aggregator",
} as const;

export const CONTEXT_ASSEMBLY_DEFAULTS = {
  MAXIMUM_BYTES_PER_ITEM:
    2 * 1024 * 1024,

  REQUIRED_LOAD_FAILURE_MODE:
    "partial" as RequiredContextLoadFailureMode,
  SENSITIVE_PATH_MODE:
    "block" as SensitiveContextPathMode,

  REDACT_SECRETS:
    true,
  ALLOW_REPRESENTATION_FALLBACK:
    true,

  TARGETED_EXCERPT_CONTEXT_LINES:
    8,

  HEAD_TAIL_HEAD_RATIO:
    0.62,
  TRUNCATION_BINARY_SEARCH_ITERATIONS:
    24,
  MINIMUM_TRUNCATED_CONTENT_CHARACTERS:
    24,

  BUILTIN_SOURCE_PRIORITY:
    100,
  WORKSPACE_SOURCE_PRIORITY:
    50,
} as const;

export const CONTEXT_ASSEMBLY_LIMITS = {
  MAXIMUM_BYTES_PER_ITEM:
    32 * 1024 * 1024,
  MAXIMUM_SOURCE_COUNT:
    100,
  MAXIMUM_WARNING_COUNT:
    10_000,
  MAXIMUM_BLOCK_COUNT:
    1_000,
  MAXIMUM_CONTENT_CHARACTERS_PER_BLOCK:
    4_000_000,
} as const;

export const CONTEXT_ASSEMBLY_REPRESENTATION_FALLBACKS:
  Readonly<
    Record<
      ContextRepresentation,
      readonly ContextRepresentation[]
    >
  > = {
  full_file: [
    "targeted_excerpt",
  ],
  exact_range: [
    "targeted_excerpt",
  ],
  targeted_excerpt: [],
  file_outline: [
    "targeted_excerpt",
  ],
  symbol_signature: [
    "targeted_excerpt",
  ],
};

export const CONTEXT_ASSEMBLY_TRUNCATION_STRATEGIES:
  Readonly<
    Record<
      ContextRepresentation,
      ContextTruncationStrategy
    >
  > = {
  full_file:
    "head_tail",
  exact_range:
    "head_tail",
  targeted_excerpt:
    "head_tail",
  file_outline:
    "head",
  symbol_signature:
    "head",
};

export const CONTEXT_ASSEMBLY_TRUNCATION_MARKERS = {
  HEAD:
    "\n[context truncated]\n",
  HEAD_TAIL:
    "\n[... repository context omitted ...]\n",
} as const;

export const CONTEXT_ASSEMBLY_ALLOWED_CONTROL_CHARACTERS =
  new Set([
    0x09,
    0x0a,
  ]);

export const CONTEXT_ASSEMBLY_SENSITIVE_EXACT_FILE_NAMES =
  new Set([
    ".env",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "credentials",
    "credentials.json",
    "id_rsa",
    "id_ed25519",
  ]);

export const CONTEXT_ASSEMBLY_SENSITIVE_ENV_PREFIX =
  ".env.";

export const CONTEXT_ASSEMBLY_SENSITIVE_FILE_SUFFIXES =
  [
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".jks",
    ".keystore",
  ] as const;

export const CONTEXT_ASSEMBLY_SAFE_TEMPLATE_SUFFIXES =
  [
    ".example",
    ".sample",
    ".template",
  ] as const;

export const CONTEXT_ASSEMBLY_SENSITIVE_PATH_SEGMENTS =
  new Set([
    ".aws",
    ".ssh",
    ".gnupg",
  ]);

export const CONTEXT_ASSEMBLY_SECRET_PATTERNS:
  readonly ContextSecretPattern[] = [
  {
    id:
      "private_key",
    pattern:
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
    replacement:
      "[REDACTED PRIVATE KEY]",
  },
  {
    id:
      "aws_access_key",
    pattern:
      /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement:
      "[REDACTED AWS ACCESS KEY]",
  },
  {
    id:
      "github_token",
    pattern:
      /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,255}\b/g,
    replacement:
      "[REDACTED GITHUB TOKEN]",
  },
  {
    id:
      "bearer_token",
    pattern:
      /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}\b/gi,
    replacement:
      "$1[REDACTED]",
  },
  {
    id:
      "jwt",
    pattern:
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement:
      "[REDACTED JWT]",
  },
  {
    id:
      "credential_assignment",
    pattern:
      /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\s*[:=]\s*["']?)[^"'\s,;}{]{8,}/gi,
    replacement:
      "$1[REDACTED]",
  },
  {
    id:
      "url_credentials",
    pattern:
      /\b(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    replacement:
      "$1[REDACTED]@",
  },
];

export const CONTEXT_ASSEMBLY_MESSAGES = {
  INVALID_OPTIONS:
    "Context-assembly options are invalid.",
  DUPLICATE_SOURCE:
    "A context content source with the same ID is already registered.",
  REGISTRY_FROZEN:
    "The context content source registry is frozen.",
  SELECTION_PARTIAL:
    "Context selection was partial, so assembly may also be incomplete.",
  SELECTION_FAILED:
    "Context selection failed; no repository context can be assembled.",
  SELECTION_CANCELLED:
    "Context selection was cancelled; no repository context can be assembled.",
  SNAPSHOT_PARTIAL:
    "The workspace snapshot is incomplete, so some selected content may be unavailable.",
  SENSITIVE_PATH_BLOCKED:
    "A selected path was blocked by the sensitive-path policy.",
  CONTENT_NOT_FOUND:
    "No registered content source found the selected repository content.",
  CONTENT_UNAVAILABLE:
    "Registered content sources could not provide the selected representation.",
  CONTENT_SOURCE_FAILED:
    "A content source failed while loading selected repository content.",
  REPRESENTATION_FALLBACK:
    "A fallback representation was used because the requested representation was unavailable.",
  CONTENT_SANITIZED:
    "Unsupported control characters were removed from repository context.",
  SECRETS_REDACTED:
    "Potential credentials or secrets were redacted from repository context.",
  CONTENT_TRUNCATED:
    "Repository context was truncated to its allocated token allowance.",
  EMPTY_CONTENT:
    "A selected repository item produced no usable content.",
  DUPLICATE_BLOCK_REMOVED:
    "A duplicate assembled context block was removed.",
  REQUIRED_CONTENT_OMITTED:
    "Required repository context could not be assembled.",
  CANCELLED:
    "Context assembly was cancelled.",
} as const;
