/** Skills catalog and workspace skill CRUD. */

import {
  authHeaders,
} from './http.js';

export async function fetchSkills(options: {
  baseUrl: string;
  token?: string;
}): Promise<
  Array<{
    id: string;
    title: string;
    description: string;
    source?: 'workspace' | 'bundled';
  }>
> {
  const res = await fetch(`${options.baseUrl}/v1/skills`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`skills_${res.status}`);
  const json = (await res.json()) as {
    skills: Array<{
      id: string;
      title: string;
      description: string;
      source?: 'workspace' | 'bundled';
    }>;
  };
  return json.skills ?? [];
}

export async function fetchWorkspaceSkills(options: {
  baseUrl: string;
  token?: string;
}): Promise<
  Array<{
    id: string;
    title: string;
    description: string;
    source: 'workspace';
  }>
> {
  const res = await fetch(`${options.baseUrl}/v1/skills/workspace`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`skills_ws_${res.status}`);
  const json = (await res.json()) as {
    skills: Array<{
      id: string;
      title: string;
      description: string;
      source: 'workspace';
    }>;
  };
  return json.skills ?? [];
}

export async function fetchWorkspaceSkill(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<{
  id: string;
  title: string;
  description: string;
  body: string;
  frontmatterYaml?: string | null;
  markdown?: string;
  path?: string;
}> {
  const res = await fetch(
    `${options.baseUrl}/v1/skills/workspace?id=${encodeURIComponent(options.id)}`,
    { headers: authHeaders(options.token) },
  );
  if (!res.ok) throw new Error(`skill_${res.status}`);
  const json = (await res.json()) as {
    skill: {
      id: string;
      title: string;
      description: string;
      body: string;
      frontmatterYaml?: string | null;
      markdown?: string;
      path?: string;
    };
  };
  return json.skill;
}

export async function saveWorkspaceSkill(options: {
  baseUrl: string;
  token?: string;
  id?: string;
  title?: string;
  description?: string;
  body?: string;
  markdown?: string;
  formatFrontmatter?: boolean;
  useAi?: boolean;
}): Promise<{
  ok: boolean;
  id: string;
  path: string;
  skill?: {
    id: string;
    title: string;
    description: string;
    body: string;
    markdown?: string;
  };
  usedAi?: boolean;
  recipeId?: string;
  profileName?: string;
}> {
  const res = await fetch(`${options.baseUrl}/v1/skills/workspace`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      action: 'save',
      id: options.id,
      title: options.title,
      description: options.description,
      body: options.body,
      markdown: options.markdown,
      formatFrontmatter: options.formatFrontmatter !== false,
      useAi: options.useAi !== false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`skill_save_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof saveWorkspaceSkill>>;
}

export async function formatWorkspaceSkill(options: {
  baseUrl: string;
  token?: string;
  id?: string;
  title?: string;
  description?: string;
  body?: string;
  markdown?: string;
  useAi?: boolean;
}): Promise<{
  ok: boolean;
  id: string;
  title: string;
  description: string;
  body: string;
  markdown: string;
  usedAi: boolean;
  recipeId: string;
  profileName: string;
}> {
  const res = await fetch(`${options.baseUrl}/v1/skills/format`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      id: options.id,
      title: options.title,
      description: options.description,
      body: options.body,
      markdown: options.markdown,
      useAi: options.useAi !== false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`skill_format_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof formatWorkspaceSkill>>;
}

export async function deleteWorkspaceSkillApi(options: {
  baseUrl: string;
  token?: string;
  id: string;
}): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`${options.baseUrl}/v1/skills/workspace`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ action: 'delete', id: options.id }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`skill_delete_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<
    ReturnType<typeof deleteWorkspaceSkillApi>
  >;
}
