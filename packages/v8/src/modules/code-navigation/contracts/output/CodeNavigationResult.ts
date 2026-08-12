import { z } from "zod";

import {
  CODE_NAVIGATION_PROVIDERS,
  CODE_NAVIGATION_REASON_CODES,
  CODE_NAVIGATION_SCHEMA_VERSION,
  CODE_NAVIGATION_STATUSES,
  CODE_NAVIGATION_WARNING_CODES,
} from "../../constants";
import {
  codeNavigationHoverSchema,
  codeNavigationLocationSchema,
  codeNavigationOperationSchema,
} from "../input/CodeNavigationInput";

export const codeNavigationStatusSchema = z.enum(CODE_NAVIGATION_STATUSES);
export const codeNavigationProviderSchema = z.enum(
  CODE_NAVIGATION_PROVIDERS,
);
export const codeNavigationReasonCodeSchema = z.enum(
  CODE_NAVIGATION_REASON_CODES,
);
export const codeNavigationWarningCodeSchema = z.enum(
  CODE_NAVIGATION_WARNING_CODES,
);

export const codeNavigationWarningSchema = z
  .object({
    code: codeNavigationWarningCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const codeNavigationResultSchema = z
  .object({
    schemaVersion: z.literal(CODE_NAVIGATION_SCHEMA_VERSION),
    status: codeNavigationStatusSchema,
    operation: codeNavigationOperationSchema,
    provider: codeNavigationProviderSchema,
    locations: z.array(codeNavigationLocationSchema),
    hover: codeNavigationHoverSchema.optional(),
    warnings: z.array(codeNavigationWarningSchema),
    reasonCodes: z.array(codeNavigationReasonCodeSchema).min(1),
  })
  .strict();

export type CodeNavigationResult = z.infer<typeof codeNavigationResultSchema>;
export type CodeNavigationStatus = z.infer<typeof codeNavigationStatusSchema>;
export type CodeNavigationReasonCode = z.infer<
  typeof codeNavigationReasonCodeSchema
>;
