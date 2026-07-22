import type { DocsSubtype } from '../types';

/**
 * Data-driven docs subtype registry. Add a new docs subtype by adding one entry here —
 * no other file needs to change. Highest `priority` wins when multiple rules match.
 */
export interface DocsRule {
  id: string;
  subtype: DocsSubtype;
  description: string;
  priority: number;
  /** Rule matches when any of these patterns test true. */
  any: RegExp[];
  /** If set, ALL of these must also test true (used for compound conditions like "mdx + fix wording"). */
  all?: RegExp[];
}

export const DOCS_RULES: readonly DocsRule[] = [
  {
    id: 'mdx-repair',
    subtype: 'mdx_repair',
    description: 'MDX/Docusaurus compilation repair — requires both MDX language and a fix/error word.',
    priority: 100,
    any: [/\b(mdx|livecodeblock|unexpected character)\b/i],
    all: [/\b(fix|repair|error|build)\b/i],
  },
  {
    id: 'docusaurus',
    subtype: 'docusaurus',
    description: 'Docusaurus site / sidebar / plugin work.',
    priority: 90,
    any: [/\b(docusaurus|docs\s+site|docs\s+plugin|sidebars?\.tsx?)\b/i],
  },
  {
    id: 'readme',
    subtype: 'readme',
    description: 'README file work.',
    priority: 80,
    any: [/\b(readme|read\s*me|readfile)\b/i],
  },
  {
    id: 'api-reference',
    subtype: 'api_reference',
    description: 'API reference / OpenAPI / Swagger docs.',
    priority: 70,
    any: [/\b(api\s+(?:docs?|reference|spec)|openapi|swagger)\b/i],
  },
  {
    id: 'architecture-docs',
    subtype: 'architecture',
    description: 'Architecture / system design documentation.',
    priority: 60,
    any: [/\b(architecture\s+(?:doc|docs|readme|overview)|system\s+design\s+doc)\b/i],
  },
  {
    id: 'changelog-docs',
    subtype: 'changelog',
    description: 'Changelog / release notes documentation.',
    priority: 50,
    any: [/\b(changelog|release\s+notes)\b/i],
  },
  {
    id: 'examples-docs',
    subtype: 'examples',
    description: 'Usage examples documentation.',
    priority: 40,
    any: [/\b(examples?\s+docs?|usage\s+examples?)\b/i],
  },
  {
    id: 'generic-docs',
    subtype: 'generic',
    description: 'General documentation mention with no more specific subtype.',
    priority: 10,
    any: [/\b(docs?|documentation|readme|mdx|docusaurus)\b/i],
  },
] as const;

/** Broad docs mention — used by the pipeline to decide whether docs subtype resolution should even run. */
export const DOCS_MENTION_RE = /\b(docs?|documentation|readme|mdx|docusaurus)\b/i;

export function matchDocsRule(text: string): DocsSubtype | undefined {
  const sorted = [...DOCS_RULES].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    const anyMatches = rule.any.some((pattern) => pattern.test(text));
    if (!anyMatches) continue;
    if (rule.all && !rule.all.every((pattern) => pattern.test(text))) continue;
    return rule.subtype;
  }
  return undefined;
}
