/** Recipes manager API. */

import {
  authHeaders,
} from './http.js';

export async function fetchRecipes(options: {
  baseUrl: string;
  token?: string;
}): Promise<{
  recipes: Array<{
    id: string;
    title: string;
    description: string;
    source: 'builtin' | 'workspace';
    mode: 'ask' | 'plan' | 'agent';
  }>;
}> {
  const res = await fetch(`${options.baseUrl}/v1/recipes`, {
    headers: authHeaders(options.token),
  });
  if (!res.ok) throw new Error(`recipes_${res.status}`);
  return (await res.json()) as Awaited<ReturnType<typeof fetchRecipes>>;
}

export async function saveRecipe(options: {
  baseUrl: string;
  token?: string;
  recipe: Record<string, unknown>;
}): Promise<{ ok: boolean; id: string; path: string }> {
  const res = await fetch(`${options.baseUrl}/v1/recipes`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({ recipe: options.recipe }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`recipe_save_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof saveRecipe>>;
}

export async function runRecipe(options: {
  baseUrl: string;
  token?: string;
  id: string;
  params?: Record<string, string>;
  note?: string;
}): Promise<{
  ok: boolean;
  compiled: {
    recipeId: string;
    title: string;
    prompt: string;
    mode: 'ask' | 'plan' | 'agent';
    requiredSkillIds: string[];
    label: string;
  };
}> {
  const res = await fetch(`${options.baseUrl}/v1/recipes/run`, {
    method: 'POST',
    headers: authHeaders(options.token),
    body: JSON.stringify({
      id: options.id,
      params: options.params,
      note: options.note,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`recipe_run_${res.status}:${text}`);
  }
  return (await res.json()) as Awaited<ReturnType<typeof runRecipe>>;
}
