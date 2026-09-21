/**
 * Workspace MCP / skills / recipes helpers for Desktop engine HTTP.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MITII_WRITING_RECIPES,
  recipeSpecSchema,
  writingRecipeToSpec,
  type RecipeSpec,
} from '@mitii/host';
import {
  readMcpSettingsFromDisk,
  writeMcpSettingsToDisk,
} from '@mitii/mcp';

export interface DesktopSkillSummary {
  id: string;
  title: string;
  description: string;
  source: 'workspace' | 'bundled';
}

export interface DesktopRecipeSummary {
  id: string;
  title: string;
  description: string;
  source: 'builtin' | 'workspace';
  mode: 'ask' | 'plan' | 'agent';
}

export function listMcpServers(workspaceRoot: string): {
  enabled: boolean;
  servers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    transport: string;
    builtin: boolean;
  }>;
} {
  const mcp = readMcpSettingsFromDisk(workspaceRoot);
  return {
    enabled: mcp.enabled,
    servers: mcp.servers.map((s) => ({
      id: s.id ?? s.name,
      name: s.name,
      enabled: s.enabled !== false && s.disabled !== true,
      transport: s.transport,
      builtin: Boolean(s.builtin),
    })),
  };
}

export function setMcpMasterEnabled(
  workspaceRoot: string,
  enabled: boolean,
): ReturnType<typeof listMcpServers> {
  const mcp = readMcpSettingsFromDisk(workspaceRoot);
  writeMcpSettingsToDisk(workspaceRoot, { ...mcp, enabled });
  return listMcpServers(workspaceRoot);
}

export function setMcpServerEnabled(
  workspaceRoot: string,
  serverId: string,
  enabled: boolean,
): ReturnType<typeof listMcpServers> {
  const mcp = readMcpSettingsFromDisk(workspaceRoot);
  const id = serverId.trim();
  let found = false;
  const servers = mcp.servers.map((s) => {
    const sid = s.id ?? s.name;
    if (sid !== id) return s;
    found = true;
    return { ...s, enabled, disabled: !enabled };
  });
  if (!found) throw new Error(`mcp_server_not_found:${id}`);
  // Turning on a server should also enable the MCP master switch.
  writeMcpSettingsToDisk(workspaceRoot, {
    enabled: enabled ? true : mcp.enabled,
    servers,
  });
  return listMcpServers(workspaceRoot);
}

function workspaceSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'skills');
}

function parseSkillFrontmatter(raw: string): {
  id?: string;
  title?: string;
  description?: string;
  body: string;
} {
  if (!raw.startsWith('---')) {
    return { body: raw };
  }
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, '');
  const out: { id?: string; title?: string; description?: string; body: string } =
    { body };
  for (const line of fm.split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim().replace(/^["']|["']$/g, '');
    if (key === 'id' || key === 'name') out.id = value;
    if (key === 'title') out.title = value;
    if (key === 'description') out.description = value;
  }
  return out;
}

export function listWorkspaceSkills(
  workspaceRoot: string,
): DesktopSkillSummary[] {
  const root = workspaceSkillsDir(workspaceRoot);
  if (!existsSync(root)) return [];
  const out: DesktopSkillSummary[] = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const skillPath = join(root, name.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    try {
      const parsed = parseSkillFrontmatter(readFileSync(skillPath, 'utf8'));
      const id = parsed.id || name.name;
      out.push({
        id,
        title: parsed.title || id,
        description: parsed.description || '',
        source: 'workspace',
      });
    } catch {
      /* skip bad skill */
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export function readWorkspaceSkill(
  workspaceRoot: string,
  skillId: string,
): { id: string; title: string; description: string; body: string } {
  const id = skillId.trim();
  if (!id) throw new Error('skill_id_required');
  const skillPath = join(workspaceSkillsDir(workspaceRoot), id, 'SKILL.md');
  if (!existsSync(skillPath)) throw new Error(`skill_not_found:${id}`);
  const parsed = parseSkillFrontmatter(readFileSync(skillPath, 'utf8'));
  return {
    id: parsed.id || id,
    title: parsed.title || id,
    description: parsed.description || '',
    body: parsed.body,
  };
}

export function writeWorkspaceSkill(
  workspaceRoot: string,
  input: {
    id: string;
    title?: string;
    description?: string;
    body: string;
  },
): { id: string; path: string } {
  const id = input.id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!id) throw new Error('invalid_skill_id');
  const dir = join(workspaceSkillsDir(workspaceRoot), id);
  mkdirSync(dir, { recursive: true });
  const title = (input.title ?? id).trim() || id;
  const description = (input.description ?? '').trim();
  const body = input.body.trim() || '# Skill\n\nDescribe what this skill should do.\n';
  const content = `---
id: ${id}
title: ${title}
description: ${description}
---

${body.endsWith('\n') ? body : `${body}\n`}`;
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, content, 'utf8');
  return { id, path: `.mitii/skills/${id}/SKILL.md` };
}

function recipesDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'recipes');
}

export function listRecipes(workspaceRoot: string): DesktopRecipeSummary[] {
  const builtin: DesktopRecipeSummary[] = MITII_WRITING_RECIPES.map((r) => ({
    id: r.id,
    title: r.title,
    description: `Built-in writing recipe (${r.command})`,
    source: 'builtin' as const,
    mode: 'ask' as const,
  }));

  const custom: DesktopRecipeSummary[] = [];
  const dir = recipesDir(workspaceRoot);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(
          readFileSync(join(dir, name), 'utf8'),
        ) as unknown;
        const spec = recipeSpecSchema.parse(raw);
        custom.push({
          id: spec.id,
          title: spec.title,
          description: spec.description ?? '',
          source: 'workspace',
          mode: spec.mode,
        });
      } catch {
        /* skip */
      }
    }
  }

  return [...builtin, ...custom];
}

export function writeRecipe(
  workspaceRoot: string,
  raw: unknown,
): { id: string; path: string } {
  const spec = recipeSpecSchema.parse(raw);
  const dir = recipesDir(workspaceRoot);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${spec.id}.json`);
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  return { id: spec.id, path: `.mitii/recipes/${spec.id}.json` };
}

export function loadDesktopRecipeSpec(
  workspaceRoot: string,
  id: string,
): RecipeSpec {
  const trimmed = id.trim();
  if (!trimmed) throw new Error('recipe_id_required');
  const builtin = MITII_WRITING_RECIPES.find((r) => r.id === trimmed);
  if (builtin) return writingRecipeToSpec(builtin.id);
  const path = join(recipesDir(workspaceRoot), `${trimmed}.json`);
  if (!existsSync(path)) throw new Error(`recipe_not_found:${trimmed}`);
  return recipeSpecSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function defaultNewRecipeDraft(id = 'my-recipe'): RecipeSpec {
  return recipeSpecSchema.parse({
    schemaVersion: 1,
    id,
    title: 'My recipe',
    description: 'Custom Mitii recipe',
    mode: 'ask',
    requiredSkillIds: [],
    promptTemplate:
      'Follow this recipe carefully.\n\n## Goal\n{{goal}}\n\n## Context\nUse the current repository.',
    params: [
      {
        name: 'goal',
        description: 'What should Mitii accomplish?',
        required: true,
        default: '',
      },
    ],
  });
}

export function defaultNewSkillDraft(id = 'my-skill'): {
  id: string;
  title: string;
  description: string;
  body: string;
} {
  return {
    id,
    title: 'My skill',
    description: 'Custom workspace skill',
    body: `# My skill

When this skill is selected, follow these instructions:

1. Clarify the goal if needed
2. Inspect the repository before changing files
3. Prefer small, verifiable changes
`,
  };
}
