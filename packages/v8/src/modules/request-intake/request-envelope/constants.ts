import type {
  UserRequestOrigin,
} from "./types";

export const REQUEST_ENVELOPE_SCHEMA_VERSION =
  1 as const;

export const REQUEST_ENVELOPE_IDS = {
  BUILDER:
    "user-request-envelope-builder",
  REQUEST_NAMESPACE:
    "request",
} as const;

export const USER_REQUEST_ORIGINS = [
  "user",
  "automation",
  "api",
] as const satisfies
  readonly UserRequestOrigin[];

export const REQUEST_ENVELOPE_DEFAULTS = {
  ORIGIN:
    "user" as UserRequestOrigin,
} as const;

export const REQUEST_ENVELOPE_LIMITS = {
  MAXIMUM_MESSAGE_CHARACTERS:
    200_000,
  MAXIMUM_REFERENCED_ARTIFACTS:
    250,
  MAXIMUM_ARTIFACT_NAME_CHARACTERS:
    500,
  MAXIMUM_ARTIFACT_PATH_CHARACTERS:
    4_096,
  MAXIMUM_LANGUAGE_CHARACTERS:
    100,
  MAXIMUM_EXTENSION_CHARACTERS:
    32,
  MAXIMUM_CONTENT_HASH_CHARACTERS:
    256,
  MAXIMUM_ROOT_IDS:
    100,
  MAXIMUM_CORRELATION_ID_CHARACTERS:
    500,
  MAXIMUM_ATTACHMENTS:
    4,
  MAXIMUM_ATTACHMENT_NAME_CHARACTERS:
    255,
  MAXIMUM_ATTACHMENT_DATA_CHARACTERS:
    8_000_000,
} as const;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const REQUEST_ENVELOPE_PATTERNS = {
  IDENTIFIER:
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/,
  EXTENSION:
    /^\.[A-Za-z0-9][A-Za-z0-9._+-]*$/,
  CONTENT_HASH:
    /^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/,
} as const;

export const REQUEST_ENVELOPE_MESSAGES = {
  REQUEST_REQUIRES_CONTENT:
    "A request requires a message or at least one referenced artifact.",
  DUPLICATE_ARTIFACT:
    "Referenced artifacts must be unique inside a request.",
  DUPLICATE_ROOT_ID:
    "Workspace root IDs must be unique.",
  INVALID_LINE_RANGE:
    "Artifact endLine must be greater than or equal to startLine.",
} as const;
