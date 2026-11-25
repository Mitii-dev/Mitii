import { z } from "zod";

import { SKILLS_ERROR_CODES } from "../../constants";

export const skillsErrorCodeSchema = z.enum(SKILLS_ERROR_CODES);

export type SkillsErrorCode = z.infer<typeof skillsErrorCodeSchema>;

export class SkillsError extends Error {
  public readonly code: SkillsErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: SkillsErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "SkillsError";
    this.code = code;
    this.details = details;
  }
}
