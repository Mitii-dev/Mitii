import {
  z,
} from "zod";

import {
  agentModeSchema,
} from "../interaction-mode";

import {
  REQUEST_ENVELOPE_LIMITS,
  REQUEST_ENVELOPE_MESSAGES,
  REQUEST_ENVELOPE_PATTERNS,
  REQUEST_ENVELOPE_SCHEMA_VERSION,
  USER_REQUEST_ORIGINS,
} from "./constants";

const identifierSchema =
  z.string()
    .min(1)
    .max(500)
    .regex(
      REQUEST_ENVELOPE_PATTERNS
        .IDENTIFIER,
    );

export const requestArtifactReferenceSchema =
  z.object({
    id:
      identifierSchema
        .optional(),
    name:
      z.string()
        .min(1)
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_ARTIFACT_NAME_CHARACTERS,
        ),
    path:
      z.string()
        .min(1)
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_ARTIFACT_PATH_CHARACTERS,
        )
        .optional(),
    kind:
      z.enum([
        "file",
        "folder",
        "attachment",
        "selection",
        "symbol",
      ]),
    extension:
      z.string()
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_EXTENSION_CHARACTERS,
        )
        .regex(
          REQUEST_ENVELOPE_PATTERNS
            .EXTENSION,
        )
        .optional(),
    language:
      z.string()
        .min(1)
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_LANGUAGE_CHARACTERS,
        )
        .optional(),
    contentHash:
      z.string()
        .min(1)
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_CONTENT_HASH_CHARACTERS,
        )
        .regex(
          REQUEST_ENVELOPE_PATTERNS
            .CONTENT_HASH,
        )
        .optional(),
    startLine:
      z.number()
        .int()
        .positive()
        .optional(),
    endLine:
      z.number()
        .int()
        .positive()
        .optional(),
  }).strict()
    .superRefine(
      (
        artifact,
        context,
      ) => {
        if (
          artifact.endLine !==
            undefined &&
          artifact.startLine ===
            undefined
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "startLine",
            ],
            message:
              "startLine is required when endLine is provided.",
          });
        }

        if (
          artifact.startLine !==
            undefined &&
          artifact.endLine !==
            undefined &&
          artifact.endLine <
            artifact.startLine
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "endLine",
            ],
            message:
              REQUEST_ENVELOPE_MESSAGES
                .INVALID_LINE_RANGE,
          });
        }
      },
    );

export const userRequestWorkspaceScopeSchema =
  z.object({
    workspaceId:
      identifierSchema,
    rootIds:
      z.array(
        identifierSchema,
      )
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_ROOT_IDS,
        )
        .refine(
          (values) =>
            new Set(values)
              .size ===
            values.length,
          {
            message:
              REQUEST_ENVELOPE_MESSAGES
                .DUPLICATE_ROOT_ID,
          },
        )
        .optional(),
    observedSnapshotId:
      identifierSchema
        .optional(),
    observedCodeIndexChangeToken:
      z.string()
        .min(1)
        .max(1_000)
        .optional(),
  }).strict();

export const userRequestCorrelationSchema =
  z.object({
    traceId:
      z.string()
        .min(1)
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_CORRELATION_ID_CHARACTERS,
        )
        .optional(),
    clientRequestId:
      z.string()
        .min(1)
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_CORRELATION_ID_CHARACTERS,
        )
        .optional(),
  }).strict()
    .refine(
      (correlation) =>
        Boolean(
          correlation.traceId ||
          correlation
            .clientRequestId,
        ),
      {
        message:
          "Correlation requires traceId or clientRequestId.",
      },
    );

export const userRequestEnvelopeSchema =
  z.object({
    schemaVersion:
      z.literal(
        REQUEST_ENVELOPE_SCHEMA_VERSION,
      ),
    requestId:
      identifierSchema,
    sessionId:
      identifierSchema,
    mode:
      agentModeSchema,
    origin:
      z.enum(
        USER_REQUEST_ORIGINS,
      ),
    message:
      z.string()
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_MESSAGE_CHARACTERS,
        ),
    referencedArtifacts:
      z.array(
        requestArtifactReferenceSchema,
      )
        .max(
          REQUEST_ENVELOPE_LIMITS
            .MAXIMUM_REFERENCED_ARTIFACTS,
        ),
    workspace:
      userRequestWorkspaceScopeSchema
        .optional(),
    correlation:
      userRequestCorrelationSchema
        .optional(),
    createdAt:
      z.string()
        .datetime({
          offset:
            false,
        }),
  }).strict()
    .superRefine(
      (
        request,
        context,
      ) => {
        if (
          !request.message
            .trim() &&
          request
            .referencedArtifacts
            .length === 0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "message",
            ],
            message:
              REQUEST_ENVELOPE_MESSAGES
                .REQUEST_REQUIRES_CONTENT,
          });
        }

        const keys =
          new Set<string>();

        request
          .referencedArtifacts
          .forEach(
            (
              artifact,
              index,
            ) => {
              const key =
                artifact.id ??
                [
                  artifact.kind,
                  artifact.path ?? "",
                  artifact.name,
                  artifact.startLine ?? "",
                  artifact.endLine ?? "",
                ].join("\u0000");

              if (keys.has(key)) {
                context.addIssue({
                  code:
                    z.ZodIssueCode
                      .custom,
                  path: [
                    "referencedArtifacts",
                    index,
                  ],
                  message:
                    REQUEST_ENVELOPE_MESSAGES
                      .DUPLICATE_ARTIFACT,
                });
              }

              keys.add(key);
            },
          );
      },
    );
