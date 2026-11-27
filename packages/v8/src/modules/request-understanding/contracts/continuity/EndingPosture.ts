import { z } from "zod";

/**
 * How the previous turn ended — stamped by runtime, consumed by RU/DP
 * for continuity bias (not inferred from reply phrasing).
 */
export const ENDING_POSTURES = [
  "answered",
  "proposal_ready",
  "mutated",
  "awaiting_approval",
  "awaiting_clarify",
  "incomplete",
] as const;

export type EndingPosture = (typeof ENDING_POSTURES)[number];

export const endingPostureSchema = z.enum(ENDING_POSTURES);
