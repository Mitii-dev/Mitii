/** Desktop engine routes: skills. */

import {
  createFileSystemSkillsCatalog,
} from '@mitii/host';
import {
  defaultNewSkillDraft,
  listWorkspaceSkills,
  readWorkspaceSkill,
  deleteWorkspaceSkill,
  writeWorkspaceSkill,
  writeWorkspaceSkillMarkdown,
} from '../extensions.js';
import {
  formatSkillFrontmatterWithAi,
  requireActiveDesktopProfile,
} from '../skills/formatFrontmatter.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetSkills(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const catalog = createFileSystemSkillsCatalog({
    workspaceRoot: cwd,
    contentMode: 'metadata',
  });
  const skills = await catalog.list();
  const workspaceIds = new Set(
    listWorkspaceSkills(cwd).map((s) => s.id),
  );
  sendJson(res, 200, {
    skills: skills.map(
      (s: { id: string; title: string; description?: string }) => ({
        id: s.id,
        title: s.title || s.id,
        description: s.description ?? '',
        source: workspaceIds.has(s.id) ? 'workspace' : 'bundled',
      }),
    ),
    workspace: listWorkspaceSkills(cwd),
  });
}

async function handleGetSkillsWorkspace(ctx: RouteContext): Promise<void> {
  const { req, res, url, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  const id = url.searchParams.get('id')?.trim() ?? '';
  if (!id) {
    sendJson(res, 200, {
      skills: listWorkspaceSkills(cwd),
      draft: defaultNewSkillDraft(),
    });
    return;
  }
  try {
    sendJson(res, 200, { skill: readWorkspaceSkill(cwd, id) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 404, { ok: false, error: message });
  }
}

async function handlePostSkillsFormat(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    requireActiveDesktopProfile(cwd);
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const markdownOrBody =
      typeof body.markdown === 'string'
        ? body.markdown
        : typeof body.body === 'string'
          ? body.body
          : '';
    if (!markdownOrBody.trim()) {
      sendJson(res, 400, { ok: false, error: 'body_required' });
      return;
    }
    const formatted = await formatSkillFrontmatterWithAi({
      workspaceRoot: cwd,
      markdownOrBody,
      ...(typeof body.id === 'string' ? { nameHint: body.id } : {}),
      ...(typeof body.title === 'string'
        ? { titleHint: body.title }
        : {}),
      ...(typeof body.description === 'string'
        ? { descriptionHint: body.description }
        : {}),
      useAi: body.useAi !== false,
    });
    sendJson(res, 200, { ok: true, ...formatted });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    const status =
      message === 'active_profile_required' ? 403 : 400;
    sendJson(res, status, { ok: false, error: message });
  }
}

async function handlePostSkillsWorkspace(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    requireActiveDesktopProfile(cwd);
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const action =
      typeof body.action === 'string' ? body.action.trim() : 'save';

    if (action === 'delete') {
      const id =
        typeof body.id === 'string'
          ? body.id
          : typeof body.skillId === 'string'
            ? body.skillId
            : '';
      const deleted = deleteWorkspaceSkill(cwd, id);
      sendJson(res, 200, {
        ok: true,
        ...deleted,
        skills: listWorkspaceSkills(cwd),
      });
      return;
    }

    const formatFrontmatter = body.formatFrontmatter !== false;
    let markdown =
      typeof body.markdown === 'string' ? body.markdown : '';
    const rawBody =
      typeof body.body === 'string' ? body.body : '';
    const idHint =
      typeof body.id === 'string' ? body.id : undefined;
    const titleHint =
      typeof body.title === 'string' ? body.title : undefined;
    const descriptionHint =
      typeof body.description === 'string'
        ? body.description
        : undefined;

    let formatMeta:
      | Awaited<ReturnType<typeof formatSkillFrontmatterWithAi>>
      | undefined;

    if (formatFrontmatter) {
      formatMeta = await formatSkillFrontmatterWithAi({
        workspaceRoot: cwd,
        markdownOrBody: markdown || rawBody,
        ...(idHint ? { nameHint: idHint } : {}),
        ...(titleHint ? { titleHint } : {}),
        ...(descriptionHint ? { descriptionHint } : {}),
        useAi: body.useAi !== false,
      });
      markdown = formatMeta.markdown;
    } else if (!markdown && rawBody) {
      const saved = writeWorkspaceSkill(cwd, {
        id: idHint || 'custom-skill',
        title: titleHint,
        description: descriptionHint,
        body: rawBody,
      });
      sendJson(res, 200, {
        ok: true,
        ...saved,
        skill: readWorkspaceSkill(cwd, saved.id),
        draft: defaultNewSkillDraft(),
      });
      return;
    }

    if (!markdown.trim()) {
      sendJson(res, 400, { ok: false, error: 'markdown_required' });
      return;
    }

    const saved = writeWorkspaceSkillMarkdown(cwd, {
      ...(idHint ? { id: idHint } : {}),
      ...(formatMeta ? { id: formatMeta.id } : {}),
      markdown,
    });
    sendJson(res, 200, {
      ok: true,
      ...saved,
      skill: readWorkspaceSkill(cwd, saved.id),
      draft: defaultNewSkillDraft(),
      ...(formatMeta
        ? {
            usedAi: formatMeta.usedAi,
            recipeId: formatMeta.recipeId,
            profileId: formatMeta.profileId,
            profileName: formatMeta.profileName,
          }
        : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    const status =
      message === 'active_profile_required' ? 403 : 400;
    sendJson(res, status, { ok: false, error: message });
  }
}

export const skillsRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/skills', handle: handleGetSkills },
  { method: 'GET', path: '/v1/skills/workspace', handle: handleGetSkillsWorkspace },
  { method: 'POST', path: '/v1/skills/format', handle: handlePostSkillsFormat },
  { method: 'POST', path: '/v1/skills/workspace', handle: handlePostSkillsWorkspace },
];
