import {
  InMemorySkillsCatalog,
  type SkillDescriptor,
  type SkillsCatalogPort,
} from '@mitii/v8';

/**
 * Bundled default skills live as `packages/sdk/skills/<skill-id>/SKILL.md`.
 *
 * Keep this export as an empty compatibility surface so callers do not carry a
 * second in-code default catalog. Hosts should use @mitii/host's filesystem
 * catalog to load bundled and workspace skills from markdown.
 */
export const DEFAULT_HOST_SKILLS: readonly SkillDescriptor[] = [];

/** In-memory catalog for tests/custom callers that explicitly pass extras. */
export function createDefaultSkillsCatalog(
  extras: readonly SkillDescriptor[] = [],
): SkillsCatalogPort {
  return new InMemorySkillsCatalog(extras);
}
