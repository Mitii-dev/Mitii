/**
 * Stable identifiers for Request Intake.
 * Stage names match numbered action files and logger events.
 */
export const REQUEST_INTAKE_STAGES = {
  sanitize: "1-sanitize",
  classifyCommand: "2-classify-command",
  extractMentions: "3-extract-mentions",
  normalizeAttachments: "4-normalize-attachments",
  resolveMode: "5-resolve-mode",
  buildEnvelope: "6-build-envelope",
} as const;

export type RequestIntakeStageName =
  (typeof REQUEST_INTAKE_STAGES)[keyof typeof REQUEST_INTAKE_STAGES];
