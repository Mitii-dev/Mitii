import { z } from "zod";

import {
  CLARIFY_ORIGINS,
  CONTINUE_REASONS,
  EXTENDED_GATE_KINDS,
  CORE_GATE_KINDS,
  TERMINAL_KINDS,
} from "./constants";

export const gateKindSchema = z.enum([
  ...CORE_GATE_KINDS,
  ...EXTENDED_GATE_KINDS,
]);

export const terminalKindSchema = z.enum(TERMINAL_KINDS);

export const clarifyOriginSchema = z.enum(CLARIFY_ORIGINS);

export const continueReasonSchema = z.enum(CONTINUE_REASONS);

export const gateVerdictSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("suspend"),
      kind: gateKindSchema,
      payload: z.record(z.unknown()).default({}),
      reasonCodes: z.array(z.string()).default([]),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      terminal: terminalKindSchema,
      payload: z.record(z.unknown()).default({}),
      reasonCodes: z.array(z.string()).default([]),
    })
    .strict(),
]);

export type GateVerdict = z.infer<typeof gateVerdictSchema>;
