import { z } from 'zod';

/** Prefix shared by every catalog key. */
export const SETTINGS_KEY_PREFIX = 'mitii.';

const jsonSchemaType = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
]);

/**
 * One `mitii.*` setting: the subset of VS Code configuration metadata that
 * every shell (VS Code, Desktop) agrees on.
 */
export const settingsCatalogEntrySchema = z
  .object({
    type: z.union([jsonSchemaType, z.array(jsonSchemaType).min(1)]),
    description: z.string().min(1),
    default: z.unknown().optional(),
    enum: z.array(z.unknown()).min(1).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  })
  .strict();

export type SettingsCatalogEntry = z.infer<typeof settingsCatalogEntrySchema>;

/** Flat catalog keyed by full `mitii.*` setting id. */
export const settingsCatalogSchema = z
  .record(
    z
      .string()
      .regex(/^mitii\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/, 'key must be mitii.<dotted.path>'),
    settingsCatalogEntrySchema,
  )
  .superRefine((catalog, ctx) => {
    const keys = Object.keys(catalog);
    for (const key of keys) {
      const clash = keys.find((other) => other.startsWith(`${key}.`));
      if (clash) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `key "${key}" is a prefix of "${clash}" and cannot be both leaf and group`,
        });
      }
      const entry = catalog[key]!;
      const value = entry.default;
      if (typeof value === 'number') {
        if (entry.minimum !== undefined && value < entry.minimum) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key, 'default'],
            message: `default ${value} is below minimum ${entry.minimum}`,
          });
        }
        if (entry.maximum !== undefined && value > entry.maximum) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key, 'default'],
            message: `default ${value} is above maximum ${entry.maximum}`,
          });
        }
      }
      if (
        entry.enum &&
        value !== undefined &&
        value !== null &&
        !entry.enum.includes(value)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key, 'default'],
          message: 'default is not a member of enum',
        });
      }
    }
  });

export type SettingsCatalog = z.infer<typeof settingsCatalogSchema>;

/** Validate untrusted catalog data; throws a ZodError on contract violations. */
export function parseSettingsCatalog(input: unknown): SettingsCatalog {
  return settingsCatalogSchema.parse(input);
}
