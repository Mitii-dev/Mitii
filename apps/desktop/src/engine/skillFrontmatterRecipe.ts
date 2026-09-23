/**
 * Internal recipe: format Mitii skill YAML frontmatter while preserving body.
 * Used by Code → Skills save flow (active profile LLM).
 */

export const SKILL_FRONTMATTER_RECIPE_ID = 'skill-frontmatter';

export const SKILL_FRONTMATTER_RECIPE = {
  id: SKILL_FRONTMATTER_RECIPE_ID,
  title: 'Skill frontmatter formatter',
  description:
    'Generate Mitii SKILL.md YAML frontmatter from a playbook body without changing the body.',
} as const;

export interface SkillFrontmatterFields {
  name: string;
  title: string;
  description: string;
  intents: string[];
  routes: string[];
  tags: string[];
  priority: number;
  when: string[];
  instruction: string;
  enabled: boolean;
  conflictGroup?: string;
  alwaysApply?: boolean;
}

export function splitSkillMarkdown(raw: string): {
  frontmatterYaml: string | null;
  body: string;
} {
  const text = raw.replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) {
    return { frontmatterYaml: null, body: text };
  }
  const end = text.indexOf('\n---', 3);
  if (end < 0) {
    return { frontmatterYaml: null, body: text };
  }
  const yaml = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  return { frontmatterYaml: yaml, body };
}

export function composeSkillMarkdown(
  fields: SkillFrontmatterFields,
  body: string,
): string {
  const lines = [
    '---',
    `name: ${fields.name}`,
    `title: ${fields.title}`,
    `description: ${escapeYamlScalar(fields.description)}`,
    `intents: [${fields.intents.map(escapeYamlListItem).join(', ')}]`,
    `routes: [${fields.routes.map(escapeYamlListItem).join(', ')}]`,
    `tags: [${fields.tags.map(escapeYamlListItem).join(', ')}]`,
    `priority: ${fields.priority}`,
  ];
  if (fields.conflictGroup) {
    lines.push(`conflictGroup: ${fields.conflictGroup}`);
  }
  if (fields.alwaysApply != null) {
    lines.push(`alwaysApply: ${fields.alwaysApply ? 'true' : 'false'}`);
  }
  lines.push(
    `when: [${fields.when.map(escapeYamlListItem).join(', ')}]`,
    `instruction: ${escapeYamlScalar(fields.instruction)}`,
    `enabled: ${fields.enabled ? 'true' : 'false'}`,
    '---',
    '',
  );
  const trimmedBody = body.replace(/^\uFEFF/, '').replace(/^\r?\n+/, '');
  return `${lines.join('\n')}${trimmedBody.endsWith('\n') ? trimmedBody : `${trimmedBody}\n`}`;
}

/** Deterministic frontmatter when AI is unavailable (echo / parse failure). */
export function fallbackSkillFrontmatter(input: {
  nameHint?: string;
  titleHint?: string;
  descriptionHint?: string;
  body: string;
}): SkillFrontmatterFields {
  const body = input.body.trim();
  const heading =
    /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ||
    input.titleHint?.trim() ||
    'Custom skill';
  const name = normalizeSkillId(
    input.nameHint || heading || 'custom-skill',
  );
  const firstParagraph =
    body
      .split(/\n\n+/)
      .map((p) => p.replace(/^#+\s+.+$/m, '').trim())
      .find((p) => p.length > 0) ?? '';
  const description =
    (input.descriptionHint?.trim() ||
      firstParagraph.replace(/\s+/g, ' ').slice(0, 160) ||
      `Workspace skill: ${heading}`).trim();
  const tags = uniqueTags([
    name,
    ...heading
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
      .slice(0, 4),
  ]);
  return {
    name,
    title: input.titleHint?.trim() || heading,
    description,
    intents: inferIntents(body, heading),
    routes: inferRoutes(body),
    tags,
    priority: 200,
    when: [
      `User asks for ${heading.toLowerCase()}`,
      `User names ${name}`,
    ],
    instruction: `Follow the ${name} playbook; keep changes scoped and verifiable.`,
    enabled: true,
  };
}

export function buildSkillFrontmatterPrompt(input: {
  nameHint?: string;
  titleHint?: string;
  descriptionHint?: string;
  body: string;
  existingYaml?: string | null;
}): string {
  return `You are Mitii's internal "${SKILL_FRONTMATTER_RECIPE.title}" recipe (${SKILL_FRONTMATTER_RECIPE_ID}).

Task: Produce ONLY a YAML frontmatter block for a Mitii SKILL.md file.
Do NOT rewrite, summarize, or modify the playbook body.
Do NOT wrap the answer in markdown fences.
Return exactly:

---
name: ...
title: ...
description: ...
intents: [...]
routes: [...]
tags: [...]
priority: <number>
when: [...]
instruction: ...
enabled: true
---

Rules:
- name: lowercase kebab-case id (max 64 chars)
- description: one concise sentence (max ~200 chars)
- intents: subset of [docs, bugfix, diagnose, review, audit, refactor, test, feature, question, explain, config]
- routes: subset of [execute, plan, diagnose, clarify]
- tags: 3–8 short keywords including the skill name
- priority: integer 100–300 (default 200 for custom skills)
- when: 1–3 short activation phrases
- instruction: one short imperative sentence
- Keep enabled: true
${input.nameHint ? `- Prefer name: ${input.nameHint}` : ''}
${input.titleHint ? `- Prefer title: ${input.titleHint}` : ''}
${input.descriptionHint ? `- Prefer description based on: ${input.descriptionHint}` : ''}
${input.existingYaml ? `\nExisting frontmatter to improve (may be incomplete):\n${input.existingYaml}\n` : ''}

Playbook body (context only — do not repeat it in your answer):
${input.body.slice(0, 12_000)}
`;
}

export function parseFrontmatterFromModelText(
  text: string,
): SkillFrontmatterFields | undefined {
  const cleaned = text
    .trim()
    .replace(/^```(?:ya?ml)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = /---\s*([\s\S]*?)\s*---/.exec(cleaned);
  const yaml = (match?.[1] ?? (cleaned.startsWith('name:') ? cleaned : ''))
    .trim();
  if (!yaml) return undefined;

  const map = new Map<string, string>();
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    map.set(
      trimmed.slice(0, idx).trim().toLowerCase(),
      trimmed.slice(idx + 1).trim(),
    );
  }

  const name = normalizeSkillId(
    unquote(map.get('name') || map.get('id') || ''),
  );
  if (!name) return undefined;
  const title = unquote(map.get('title') || name);
  const description = unquote(map.get('description') || title);
  return {
    name,
    title,
    description,
    intents: parseList(map.get('intents')).slice(0, 8),
    routes: parseList(map.get('routes')).slice(0, 6),
    tags: parseList(map.get('tags')).slice(0, 12),
    priority: clampPriority(map.get('priority')),
    when: parseList(map.get('when')).slice(0, 5),
    instruction:
      unquote(map.get('instruction') || '') ||
      `Follow the ${name} playbook.`,
    enabled: map.get('enabled') !== 'false',
    ...(map.get('conflictgroup')
      ? { conflictGroup: unquote(map.get('conflictgroup')!) }
      : {}),
    ...(map.has('alwaysapply')
      ? { alwaysApply: map.get('alwaysapply') === 'true' }
      : {}),
  };
}

export function normalizeSkillId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  const inner =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1)
      : trimmed;
  return inner
    .split(',')
    .map((item) => unquote(item.trim()))
    .filter(Boolean);
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function clampPriority(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(999, Math.floor(n)));
}

function escapeYamlScalar(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (/[:#\[\]{},]|^\s|\s$/.test(trimmed)) {
    return JSON.stringify(trimmed);
  }
  return trimmed;
}

function escapeYamlListItem(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  if (/[:#\[\]{},]|^\s|\s$/.test(trimmed)) {
    return JSON.stringify(trimmed);
  }
  return trimmed;
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const t = tag.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 8);
}

function inferIntents(body: string, title: string): string[] {
  const text = `${title}\n${body}`.toLowerCase();
  const intents: string[] = [];
  if (/doc|readme|changelog|explain/.test(text)) intents.push('docs');
  if (/bug|fix|debug|error/.test(text)) intents.push('bugfix');
  if (/review|audit|quality/.test(text)) intents.push('review');
  if (/test|spec|tdd/.test(text)) intents.push('test');
  if (/refactor|architecture/.test(text)) intents.push('refactor');
  if (/plan|breakdown/.test(text)) intents.push('feature');
  return intents.length > 0 ? intents.slice(0, 4) : ['docs'];
}

function inferRoutes(body: string): string[] {
  const text = body.toLowerCase();
  if (/plan|breakdown|steps/.test(text)) return ['plan', 'execute'];
  if (/diagnos|debug|triage/.test(text)) return ['diagnose', 'execute'];
  return ['execute'];
}
