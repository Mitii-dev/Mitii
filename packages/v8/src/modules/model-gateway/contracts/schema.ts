import {
  z,
} from "zod";

import {
  MODEL_ERROR_CODES,
  MODEL_GATEWAY_LIMITS,
  MODEL_GATEWAY_MESSAGES,
  MODEL_GATEWAY_PATTERNS,
  MODEL_REASONING_EFFORTS,
  MODEL_TOOL_CHOICES,
} from "../constants";

const jsonObjectSchema =
  z.record(
    z.string(),
    z.unknown(),
  );

export const modelMessageSchema =
  z.object({
    role:
      z.enum([
        "system",
        "user",
        "assistant",
        "tool",
      ]),
    content:
      z.string()
        .max(
          MODEL_GATEWAY_LIMITS
            .MAXIMUM_MESSAGE_CHARACTERS,
        ),
    name:
      z.string()
        .min(1)
        .optional(),
    toolCallId:
      z.string()
        .min(1)
        .optional(),
    toolCalls:
      z.array(
        z.object({
          id:
            z.string()
              .min(1),
          name:
            z.string()
              .min(1),
          arguments:
            z.string(),
          thoughtSignature:
            z.string()
              .min(1)
              .optional(),
        }).strict(),
      )
        .optional(),
    attachments:
      z.array(
        z.object({
          kind:
            z.literal(
              "image",
            ),
          mimeType:
            z.string()
              .min(1),
          data:
            z.string()
              .min(1),
          name:
            z.string()
              .min(1)
              .optional(),
        }).strict(),
      )
        .optional(),
  }).strict()
    .superRefine(
      (
        message,
        context,
      ) => {
        if (
          message.role ===
            "tool" &&
          !message.toolCallId
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "toolCallId",
            ],
            message:
              MODEL_GATEWAY_MESSAGES
                .TOOL_RESULT_REQUIRES_CALL_ID,
          });
        }
      },
    );

export const modelToolDefinitionSchema =
  z.object({
    name:
      z.string()
        .min(1),
    description:
      z.string()
        .min(1),
    inputSchema:
      jsonObjectSchema
        .refine(
          (value) =>
            JSON.stringify(value)
              .length <=
            MODEL_GATEWAY_LIMITS
              .MAXIMUM_TOOL_SCHEMA_CHARACTERS,
          {
            message:
              "Tool input schema exceeds the configured character limit.",
          },
        ),
  }).strict();

const responseFormatSchema =
  z.discriminatedUnion(
    "type",
    [
      z.object({
        type:
          z.literal(
            "text",
          ),
      }).strict(),
      z.object({
        type:
          z.literal(
            "json_object",
          ),
      }).strict(),
      z.object({
        type:
          z.literal(
            "json_schema",
          ),
        name:
          z.string()
            .min(1),
        schema:
          jsonObjectSchema,
        strict:
          z.boolean()
            .optional(),
      }).strict(),
    ],
  );

export const modelRequestSchema =
  z.object({
    messages:
      z.array(
        modelMessageSchema,
      )
        .min(1)
        .max(
          MODEL_GATEWAY_LIMITS
            .MAXIMUM_MESSAGES,
        ),
    model:
      z.string()
        .min(1)
        .regex(
          MODEL_GATEWAY_PATTERNS
            .MODEL_ID,
        )
        .optional(),
    temperature:
      z.number()
        .min(0)
        .max(
          MODEL_GATEWAY_LIMITS
            .MAXIMUM_TEMPERATURE,
        )
        .optional(),
    maximumOutputTokens:
      z.number()
        .int()
        .min(
          MODEL_GATEWAY_LIMITS
            .MINIMUM_OUTPUT_TOKENS,
        )
        .max(
          MODEL_GATEWAY_LIMITS
            .MAXIMUM_OUTPUT_TOKENS,
        )
        .optional(),
    stream:
      z.boolean()
        .optional(),
    tools:
      z.array(
        modelToolDefinitionSchema,
      )
        .max(
          MODEL_GATEWAY_LIMITS
            .MAXIMUM_TOOLS,
        )
        .optional(),
    toolChoice:
      z.enum(
        MODEL_TOOL_CHOICES,
      )
        .optional(),
    reasoning:
      z.object({
        enabled:
          z.boolean(),
        effort:
          z.enum(
            MODEL_REASONING_EFFORTS,
          ),
        includeInResponse:
          z.boolean(),
      }).strict()
        .optional(),
    responseFormat:
      responseFormatSchema
        .optional(),
  }).strict()
    .superRefine(
      (
        request,
        context,
      ) => {
        if (
          request.toolChoice &&
          request.toolChoice !==
            "none" &&
          (
            request.tools
              ?.length ??
            0
          ) === 0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "toolChoice",
            ],
            message:
              MODEL_GATEWAY_MESSAGES
                .TOOL_CHOICE_REQUIRES_TOOLS,
          });
        }
      },
    );

export const modelErrorSchema =
  z.object({
    code:
      z.enum(
        MODEL_ERROR_CODES,
      ),
    message:
      z.string()
        .min(1),
    retryable:
      z.boolean(),
    retryAfterMs:
      z.number()
        .int()
        .nonnegative()
        .max(
          MODEL_GATEWAY_LIMITS
            .MAXIMUM_RETRY_AFTER_MS,
        )
        .optional(),
    providerCode:
      z.string()
        .min(1)
        .optional(),
  }).strict();

const modelToolCallDeltaSchema = z
  .object({
    index: z.number().int().nonnegative(),
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    arguments: z.string().optional(),
    thoughtSignature: z.string().min(1).optional(),
  })
  .strict();

const modelTokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cacheHitTokens: z.number().int().nonnegative().optional(),
    cacheMissTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const modelFinishReasonSchema = z.enum([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "cancelled",
  "error",
  "unknown",
]);

export const modelEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("content_delta"),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("reasoning_delta"),
      reasoning: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_call_delta"),
      toolCalls: z.array(modelToolCallDeltaSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("usage"),
      usage: modelTokenUsageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("completed"),
      finishReason: modelFinishReasonSchema,
      usage: modelTokenUsageSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("failed"),
      error: modelErrorSchema,
      finishReason: modelFinishReasonSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("cancelled"),
      error: modelErrorSchema,
    })
    .strict(),
]);

/** @deprecated Use modelEventSchema */
export const modelResponseDeltaSchema = modelEventSchema;

export const modelCapabilitiesSchema =
  z.object({
    modelId:
      z.string()
        .min(1)
        .regex(
          MODEL_GATEWAY_PATTERNS
            .MODEL_ID,
        ),
    contextWindowTokens:
      z.number()
        .int()
        .min(
          MODEL_GATEWAY_LIMITS
            .MINIMUM_CONTEXT_WINDOW_TOKENS,
        )
        .max(
          MODEL_GATEWAY_LIMITS
            .MAXIMUM_CONTEXT_WINDOW_TOKENS,
        ),
    maximumOutputTokens:
      z.number()
        .int()
        .min(
          MODEL_GATEWAY_LIMITS
            .MINIMUM_OUTPUT_TOKENS,
        )
        .max(
          MODEL_GATEWAY_LIMITS
            .MAXIMUM_OUTPUT_TOKENS,
        ),
    supportsStreaming:
      z.boolean(),
    supportsTools:
      z.boolean(),
    supportsParallelToolCalls:
      z.boolean(),
    supportsStructuredOutput:
      z.boolean(),
    supportsVision:
      z.boolean(),
    supportsReasoning:
      z.boolean(),
    supportsPromptCaching:
      z.boolean(),
    supportsEmbeddings:
      z.boolean(),
    agenticTier:
      z.enum([
        "basic",
        "standard",
        "advanced",
      ])
        .optional(),
  }).strict()
    .superRefine(
      (
        capabilities,
        context,
      ) => {
        if (
          capabilities
            .maximumOutputTokens >
          capabilities
            .contextWindowTokens
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "maximumOutputTokens",
            ],
            message:
              MODEL_GATEWAY_MESSAGES
                .OUTPUT_EXCEEDS_CONTEXT,
          });
        }

        if (
          capabilities
            .supportsParallelToolCalls &&
          !capabilities
            .supportsTools
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode
                .custom,
            path: [
              "supportsParallelToolCalls",
            ],
            message:
              MODEL_GATEWAY_MESSAGES
                .PARALLEL_TOOLS_REQUIRE_TOOLS,
          });
        }
      },
    );
