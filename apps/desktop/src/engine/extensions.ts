/**
 * Workspace MCP / skills / recipes helpers for Desktop engine HTTP.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MITII_WRITING_RECIPES,
  recipeSpecSchema,
  writingRecipeToSpec,
  type RecipeSpec,
} from '@mitii/host';
import {
  createBuiltinMcpCatalog,
  getBuiltinCatalogEntry,
  isMcpBuiltinId,
  readMcpSettingsFromDisk,
  writeMcpSettingsToDisk,
  type McpServerConfig,
  type McpTransport,
} from '@mitii/mcp';
import {
  composeSkillMarkdown,
  fallbackSkillFrontmatter,
  normalizeSkillId,
  splitSkillMarkdown,
} from './skills/frontmatterRecipe.js';

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
  catalog: Array<{
    id: string;
    name: string;
    transport: string;
    description: string;
    installed: boolean;
  }>;
} {
  const mcp = readMcpSettingsFromDisk(workspaceRoot);
  const servers = mcp.servers.map((s) => ({
    id: s.id ?? s.name,
    name: s.name,
    enabled: s.enabled !== false && s.disabled !== true,
    transport: s.transport,
    builtin: Boolean(s.builtin),
  }));
  const installedIds = new Set(servers.map((s) => s.id.toLowerCase()));
  const catalog = createBuiltinMcpCatalog(workspaceRoot).map((entry) => ({
    id: entry.id ?? entry.name,
    name: entry.name,
    transport: entry.transport,
    description: catalogDescription(entry.id ?? entry.name),
    installed: installedIds.has((entry.id ?? entry.name).toLowerCase()),
  }));
  return {
    enabled: mcp.enabled,
    servers,
    catalog,
  };
}

function catalogDescription(id: string): string {
  switch (id) {
    case 'filesystem':
      return 'Bounded filesystem tools for this workspace.';
    case 'sequential-thinking':
      return 'Structured multi-step reasoning helper.';
    case 'memory':
      return 'External memory tools via MCP.';
    case 'puppeteer':
      return 'Browser automation via Puppeteer.';
    case 'excalidraw':
      return 'Hand-drawn architecture diagrams (mcp.excalidraw.com).';
    default:
      return 'Built-in Mitii MCP server.';
  }
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

function normalizeMcpId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/** Install a built-in catalog server into `.mitii/mcp.json` (enabled). */
export function installBuiltinMcpServer(
  workspaceRoot: string,
  builtinId: string,
): ReturnType<typeof listMcpServers> {
  if (!isMcpBuiltinId(builtinId)) {
    throw new Error(`unknown_builtin_mcp:${builtinId}`);
  }
  const mcp = readMcpSettingsFromDisk(workspaceRoot);
  const id = builtinId.trim().toLowerCase();
  if (mcp.servers.some((s) => (s.id ?? s.name).toLowerCase() === id)) {
    throw new Error(`mcp_already_installed:${id}`);
  }
  const entry = {
    ...getBuiltinCatalogEntry(builtinId, workspaceRoot),
    enabled: true,
    disabled: false,
  };
  writeMcpSettingsToDisk(workspaceRoot, {
    enabled: true,
    servers: [...mcp.servers, entry],
  });
  return listMcpServers(workspaceRoot);
}

/** Add a custom MCP server (stdio / sse / streamable-http). */
export function addCustomMcpServer(
  workspaceRoot: string,
  input: {
    id: string;
    name: string;
    transport: McpTransport;
    command?: string;
    args?: string[];
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    enabled?: boolean;
  },
): ReturnType<typeof listMcpServers> {
  const id = normalizeMcpId(input.id || input.name);
  if (!id) throw new Error('invalid_mcp_id');
  const name = input.name.trim() || id;
  const transport = input.transport;
  if (
    transport !== 'stdio' &&
    transport !== 'sse' &&
    transport !== 'streamable-http'
  ) {
    throw new Error(`invalid_mcp_transport:${String(transport)}`);
  }

  const mcp = readMcpSettingsFromDisk(workspaceRoot);
  if (mcp.servers.some((s) => (s.id ?? s.name).toLowerCase() === id)) {
    throw new Error(`mcp_already_installed:${id}`);
  }

  const enabled = input.enabled !== false;
  let server: McpServerConfig;
  if (transport === 'stdio') {
    const command = (input.command ?? '').trim();
    if (!command) throw new Error('mcp_command_required');
    server = {
      id,
      name,
      transport: 'stdio',
      command,
      ...(input.args?.length ? { args: input.args } : {}),
      ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
      enabled,
      disabled: !enabled,
      builtin: false,
    };
  } else {
    const url = (input.url ?? '').trim();
    if (!url) throw new Error('mcp_url_required');
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      throw new Error('mcp_url_invalid');
    }
    server = {
      id,
      name,
      transport,
      url,
      ...(input.headers && Object.keys(input.headers).length
        ? { headers: input.headers }
        : {}),
      enabled,
      disabled: !enabled,
      builtin: false,
    };
  }

  writeMcpSettingsToDisk(workspaceRoot, {
    enabled: enabled ? true : mcp.enabled,
    servers: [...mcp.servers, server],
  });
  return listMcpServers(workspaceRoot);
}

/** Remove an installed MCP server from `.mitii/mcp.json`. */
export function deleteMcpServer(
  workspaceRoot: string,
  serverId: string,
): ReturnType<typeof listMcpServers> {
  const id = serverId.trim();
  if (!id) throw new Error('mcp_server_id_required');
  const mcp = readMcpSettingsFromDisk(workspaceRoot);
  const next = mcp.servers.filter((s) => (s.id ?? s.name) !== id);
  if (next.length === mcp.servers.length) {
    throw new Error(`mcp_server_not_found:${id}`);
  }
  writeMcpSettingsToDisk(workspaceRoot, {
    enabled: mcp.enabled,
    servers: next,
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
  frontmatterYaml: string | null;
  markdown: string;
} {
  const { frontmatterYaml, body } = splitSkillMarkdown(raw);
  const out: {
    id?: string;
    title?: string;
    description?: string;
    body: string;
    frontmatterYaml: string | null;
    markdown: string;
  } = {
    body,
    frontmatterYaml,
    markdown: raw.replace(/^\uFEFF/, ''),
  };
  if (!frontmatterYaml) return out;
  for (const line of frontmatterYaml.split('\n')) {
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
): {
  id: string;
  title: string;
  description: string;
  body: string;
  frontmatterYaml: string | null;
  markdown: string;
  path: string;
} {
  const id = skillId.trim();
  if (!id) throw new Error('skill_id_required');
  const relativePath = `.mitii/skills/${id}/SKILL.md`;
  const skillPath = join(workspaceSkillsDir(workspaceRoot), id, 'SKILL.md');
  if (!existsSync(skillPath)) throw new Error(`skill_not_found:${id}`);
  const parsed = parseSkillFrontmatter(readFileSync(skillPath, 'utf8'));
  return {
    id: parsed.id || id,
    title: parsed.title || id,
    description: parsed.description || '',
    body: parsed.body,
    frontmatterYaml: parsed.frontmatterYaml,
    markdown: parsed.markdown,
    path: relativePath,
  };
}

/** Write a skill from full markdown (frontmatter + body). */
export function writeWorkspaceSkillMarkdown(
  workspaceRoot: string,
  input: { id?: string; markdown: string },
): { id: string; path: string } {
  const parsed = parseSkillFrontmatter(input.markdown);
  const id = normalizeSkillId(input.id || parsed.id || 'custom-skill');
  if (!id) throw new Error('invalid_skill_id');
  const fields = fallbackSkillFrontmatter({
    nameHint: id,
    titleHint: parsed.title,
    descriptionHint: parsed.description,
    body: parsed.body,
  });
  // Prefer existing YAML fields when present in markdown.
  if (parsed.frontmatterYaml) {
    const composed = input.markdown.replace(/^\uFEFF/, '').trim();
    if (composed.startsWith('---')) {
      const dir = join(workspaceSkillsDir(workspaceRoot), id);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'SKILL.md');
      const content = composed.endsWith('\n') ? composed : `${composed}\n`;
      writeFileSync(path, content, 'utf8');
      return { id, path: `.mitii/skills/${id}/SKILL.md` };
    }
  }
  const markdown = composeSkillMarkdown(
    {
      ...fields,
      name: id,
      title: parsed.title || fields.title,
      description: parsed.description || fields.description,
    },
    parsed.body,
  );
  const dir = join(workspaceSkillsDir(workspaceRoot), id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, markdown, 'utf8');
  return { id, path: `.mitii/skills/${id}/SKILL.md` };
}

export function writeWorkspaceSkill(
  workspaceRoot: string,
  input: {
    id: string;
    title?: string;
    description?: string;
    body: string;
    /** When true, only body is provided — synthesize frontmatter deterministically. */
    synthesizeFrontmatter?: boolean;
  },
): { id: string; path: string } {
  const id = normalizeSkillId(input.id);
  if (!id) throw new Error('invalid_skill_id');
  const { body } = splitSkillMarkdown(input.body);
  const fields = fallbackSkillFrontmatter({
    nameHint: id,
    titleHint: input.title,
    descriptionHint: input.description,
    body,
  });
  const markdown = composeSkillMarkdown(
    {
      ...fields,
      name: id,
      title: (input.title ?? fields.title).trim() || id,
      description: (input.description ?? fields.description).trim(),
    },
    body,
  );
  const dir = join(workspaceSkillsDir(workspaceRoot), id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, markdown, 'utf8');
  return { id, path: `.mitii/skills/${id}/SKILL.md` };
}

export function deleteWorkspaceSkill(
  workspaceRoot: string,
  skillId: string,
): { id: string } {
  const id = normalizeSkillId(skillId);
  if (!id) throw new Error('invalid_skill_id');
  const dir = join(workspaceSkillsDir(workspaceRoot), id);
  if (!existsSync(dir)) throw new Error(`skill_not_found:${id}`);
  rmSync(dir, { recursive: true, force: true });
  return { id };
}

export function defaultNewSkillDraft(id = 'my-skill'): {
  id: string;
  title: string;
  description: string;
  body: string;
  markdown: string;
} {
  const skillId = normalizeSkillId(id) || 'my-skill';
  const body = `# ${skillId}

When this skill is selected, follow these instructions:

1. Clarify the goal if needed
2. Inspect the repository before changing files
3. Prefer small, verifiable changes
`;
  const fields = fallbackSkillFrontmatter({
    nameHint: skillId,
    titleHint: 'My skill',
    descriptionHint: 'Custom workspace skill',
    body,
  });
  return {
    id: skillId,
    title: fields.title,
    description: fields.description,
    body,
    markdown: composeSkillMarkdown(fields, body),
  };
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
