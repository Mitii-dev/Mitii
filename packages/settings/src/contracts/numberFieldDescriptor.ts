import { z } from 'zod';

/** Rendering kind of a numeric policy field. */
export const numberFieldKindSchema = z.enum(['ratio', 'int', 'number']);
export type NumberFieldKind = z.infer<typeof numberFieldKindSchema>;

export const NUMBER_FIELD_TIERS = ['simple', 'advanced'] as const;
export const numberFieldTierSchema = z.enum(NUMBER_FIELD_TIERS);

/**
 * One numeric policy field projected from the catalog. Structurally identical
 * to the UI token-budget descriptor so hosts can hand it to a renderer
 * without conversion.
 */
export const numberFieldDescriptorSchema = z
  .object({
    key: z.string().min(1),
    group: z.string().min(1),
    label: z.string().min(1),
    description: z.string(),
    docsHref: z.string().optional(),
    kind: numberFieldKindSchema,
    min: z.number(),
    max: z.number().optional(),
    step: z.number().positive(),
    defaultValue: z.number().optional(),
    tier: numberFieldTierSchema.optional(),
    hiddenFromDebug: z.boolean().optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.max !== undefined && field.max < field.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max'],
        message: `max ${field.max} is below min ${field.min}`,
      });
    }
  });

export type NumberFieldDescriptor = z.infer<typeof numberFieldDescriptorSchema>;

/**
 * Presentation-only facts a catalog cannot express. Never carries bounds,
 * description, or keys — those always come from the catalog.
 */
export const numberFieldPresentationSchema = z
  .object({
    group: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    docsHref: z.string().optional(),
    kind: numberFieldKindSchema.optional(),
    step: z.number().positive().optional(),
    tier: numberFieldTierSchema.optional(),
    hiddenFromDebug: z.boolean().optional(),
  })
  .strict();

export type NumberFieldPresentation = z.infer<
  typeof numberFieldPresentationSchema
>;

/** Presentation overlay keyed by the catalog short key (e.g. `outputRatio`). */
export const numberFieldPresentationMapSchema = z.record(
  numberFieldPresentationSchema,
);
export type NumberFieldPresentationMap = z.infer<
  typeof numberFieldPresentationMapSchema
>;

/** Stable reason codes for projection failures. */
export const PROJECT_NUMBER_FIELDS_REASONS = [
  'unknown_overlay_key',
  'unknown_default_key',
  'invalid_overlay',
  'invalid_descriptor',
] as const;
export type ProjectNumberFieldsReason =
  (typeof PROJECT_NUMBER_FIELDS_REASONS)[number];

export class ProjectNumberFieldsError extends Error {
  readonly reason: ProjectNumberFieldsReason;
  readonly keys: readonly string[];

  constructor(
    reason: ProjectNumberFieldsReason,
    keys: readonly string[],
    detail?: string,
  ) {
    super(
      `projectNumberFields: ${reason}${keys.length ? ` [${keys.join(', ')}]` : ''}${detail ? ` — ${detail}` : ''}`,
    );
    this.name = 'ProjectNumberFieldsError';
    this.reason = reason;
    this.keys = keys;
  }
}
