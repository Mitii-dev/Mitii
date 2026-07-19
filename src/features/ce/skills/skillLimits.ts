/** Hard limits for Mitii workspace skills under .mitii/skills/<name>/SKILL.md. */
export const MAX_SKILL_DESCRIPTION_CHARS = 240;
/** Soft authoring target for a single SKILL.md body (characters). */
export const RECOMMENDED_SKILL_BODY_CHARS = 8_000;
/** Hard ceiling for full playbook injection / use_skill output. */
export const MAX_SKILL_INJECTION_CHARS = 24_000;
/** Fallback body size when no Quick Reference or Overview section exists. */
export const QUICK_REF_FALLBACK_CHARS = 800;
/** Max directory depth when discovering SKILL.md files. */
export const MAX_SKILL_WALK_DEPTH = 6;
/** Soft selection caps (guidance for using-agent-skills). */
export const SKILL_SELECTION_SOFT_CAPS = {
  normal: 1,
  multiStep: 2,
  compound: 3,
} as const;
