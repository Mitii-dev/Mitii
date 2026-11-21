/** Desktop engine routes: recipes. */

import {
  compileRecipeToStartInput,
} from '@mitii/host';
import {
  defaultNewRecipeDraft,
  listRecipes,
  loadDesktopRecipeSpec,
  writeRecipe,
} from '../extensions.js';
import {
  sendJson,
  requireAuth,
  readJsonBody,
} from '../http/httpUtils.js';
import {
  readCommitMessageStyle,
} from '../http/bodyParsers.js';
import {
  type RouteContext,
  type Route,
} from '../http/types.js';

async function handleGetRecipes(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  sendJson(res, 200, {
    recipes: listRecipes(cwd),
    draft: defaultNewRecipeDraft(),
  });
}

async function handlePostRecipes(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const saved = writeRecipe(cwd, body.recipe ?? body);
    sendJson(res, 200, { ok: true, ...saved });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function handlePostRecipesRun(ctx: RouteContext): Promise<void> {
  const { req, res, token, cwd } = ctx;
  if (!requireAuth(req, res, token)) return;
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    const params =
      body.params && typeof body.params === 'object'
        ? (body.params as Record<string, string>)
        : {};
    const note =
      typeof body.note === 'string' ? body.note : undefined;
    const commitMessageStyle = readCommitMessageStyle(body);
    const spec = loadDesktopRecipeSpec(cwd, id);
    const compiled = await compileRecipeToStartInput(spec, {
      workspaceRoot: cwd,
      params,
      userNote: note,
      ...(commitMessageStyle ? { commitMessageStyle } : {}),
    });
    sendJson(res, 200, { ok: true, compiled });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

export const recipesRoutes: readonly Route[] = [
  { method: 'GET', path: '/v1/recipes', handle: handleGetRecipes },
  { method: 'POST', path: '/v1/recipes', handle: handlePostRecipes },
  { method: 'POST', path: '/v1/recipes/run', handle: handlePostRecipesRun },
];
