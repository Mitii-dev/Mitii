import { z } from "zod";

export const runtimeRunStatusSchema = z.enum([
  "completed",
  "completed_with_verification_warnings",
  "partially_completed",
  "failed",
  "cancelled",
  "suspended",
  "not_implemented",
]);

export type RuntimeRunStatus = z.infer<typeof runtimeRunStatusSchema>;
