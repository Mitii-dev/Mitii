import { describe, expect, it } from 'vitest';

import {
  DEBUG_API_DATA_PATH_RECIPE_ID,
  DEBUG_API_DATA_PATH_SKILL_ID,
  buildDebugApiDataPathAsk,
  debugApiDataPathToSpec,
  isDebugApiDataPathRecipeId,
} from './debugApiDataPath.js';

describe('debugApiDataPath recipe', () => {
  it('spec force-attaches api-db-runtime-debug in agent mode', () => {
    const spec = debugApiDataPathToSpec();
    expect(spec.id).toBe(DEBUG_API_DATA_PATH_RECIPE_ID);
    expect(spec.mode).toBe('agent');
    expect(spec.requiredSkillIds).toEqual([DEBUG_API_DATA_PATH_SKILL_ID]);
    expect(spec.params.map((p) => p.name)).toEqual([
      'endpoint',
      'tableOrEntity',
      'baseUrl',
    ]);
  });

  it('compiles prompt with endpoint and table params', async () => {
    const compiled = await buildDebugApiDataPathAsk({
      endpoint: '/v2/api/users',
      tableOrEntity: 'users',
      baseUrl: 'http://localhost:3000',
    });

    expect(compiled.recipeId).toBe(DEBUG_API_DATA_PATH_RECIPE_ID);
    expect(compiled.mode).toBe('agent');
    expect(compiled.requiredSkillIds).toContain(DEBUG_API_DATA_PATH_SKILL_ID);
    expect(compiled.prompt).toContain('/v2/api/users');
    expect(compiled.prompt).toContain('users');
    expect(compiled.prompt).toContain('http://localhost:3000');
    expect(compiled.prompt).toMatch(/Probe the API/i);
    expect(JSON.stringify(compiled)).not.toMatch(/allowedTools|ToolGrant/);
  });

  it('requires endpoint and tableOrEntity', async () => {
    await expect(
      buildDebugApiDataPathAsk({
        endpoint: '',
        tableOrEntity: 'users',
      }),
    ).rejects.toThrow(/requires param "endpoint"/i);
  });

  it('recognizes recipe id', () => {
    expect(isDebugApiDataPathRecipeId('debug-api-data-path')).toBe(true);
    expect(isDebugApiDataPathRecipeId('other')).toBe(false);
  });
});
