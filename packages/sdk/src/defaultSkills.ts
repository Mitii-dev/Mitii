import {
  InMemorySkillsCatalog,
  type SkillDescriptor,
  type SkillsCatalogPort,
} from '@mitii/v8';

/**
 * Minimal host skills for local F5 / CLI smoke.
 * Hosts may replace this catalog; marketplace/plugin loaders stay out of SDK.
 */
export const DEFAULT_HOST_SKILLS: readonly SkillDescriptor[] = [
  {
    id: 'safety-always',
    title: 'Safety',
    content:
      'Never invent permissions beyond the granted tools. Prefer the smallest safe change.',
    intents: [],
    routes: [],
    tags: [],
    priority: 200,
    alwaysApply: true,
  },
  {
    id: 'ask-concise',
    title: 'Concise answers',
    content:
      'Answer directly with evidence. Prefer short explanations over long narratives.',
    intents: ['question'],
    routes: ['direct_answer', 'repository_answer'],
    tags: ['ask', 'explain'],
    priority: 110,
    alwaysApply: false,
  },
  {
    id: 'bugfix-localize',
    title: 'Localize bug fixes',
    content: 'Prefer the smallest change that fixes the reported failure.',
    intents: ['bugfix'],
    routes: ['execute', 'diagnose'],
    tags: ['null', 'fix', 'error'],
    priority: 120,
    alwaysApply: false,
  },
];

/** In-memory catalog used by CLI and VS Code when no custom catalog is injected. */
export function createDefaultSkillsCatalog(
  extras: readonly SkillDescriptor[] = [],
): SkillsCatalogPort {
  return new InMemorySkillsCatalog([...DEFAULT_HOST_SKILLS, ...extras]);
}
