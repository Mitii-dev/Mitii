import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compileRecipeToStartInput,
  recipeSpecSchema,
  renderRecipePrompt,
  writingRecipeToSpec,
} from './recipeSpec.js';

describe('RecipeSpec', () => {
  it('renders params and fails on missing required params', () => {
    const spec = recipeSpecSchema.parse({
      schemaVersion: 1,
      id: 'after-commit',
      title: 'After commit',
      promptTemplate: 'After commit {{sha}}: {{task}}',
      params: [
        { name: 'sha', required: true },
        { name: 'task', required: true, default: 'write tests' },
      ],
    });

    expect(renderRecipePrompt(spec, { sha: 'abc123' })).toBe(
      'After commit abc123: write tests',
    );
    expect(() => renderRecipePrompt(spec, {})).toThrow(/requires param "sha"/);
  });

  it('compileRecipeToStartInput never emits grant/tool fields', async () => {
    const spec = recipeSpecSchema.parse({
      schemaVersion: 1,
      id: 'plan-pr',
      title: 'Plan then PR',
      mode: 'plan',
      autonomyPreset: 'propose',
      requiredSkillIds: ['git-pr-summary'],
      promptTemplate: 'Open a PR for {{branch}}',
      params: [{ name: 'branch', required: true }],
    });

    const compiled = await compileRecipeToStartInput(spec, {
      workspaceRoot: process.cwd(),
      params: { branch: 'feat/x' },
    });

    expect(compiled).toMatchObject({
      recipeId: 'plan-pr',
      mode: 'plan',
      autonomyPreset: 'propose',
      requiredSkillIds: ['git-pr-summary'],
      prompt: 'Open a PR for feat/x',
    });
    expect(compiled).not.toHaveProperty('allowedTools');
    expect(compiled).not.toHaveProperty('toolGrant');
    expect(JSON.stringify(compiled)).not.toMatch(/allowedTools|ToolGrant/);
  });

  it('loads RecipeSpec from .mitii/recipes/<id>.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-recipe-'));
    await mkdir(join(root, '.mitii', 'recipes'), { recursive: true });
    await writeFile(
      join(root, '.mitii', 'recipes', 'smoke.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'smoke',
        title: 'Smoke',
        promptTemplate: 'Say {{word}}',
        params: [{ name: 'word', required: true }],
      }),
    );

    const { loadRecipeSpec } = await import('./recipeSpec.js');
    const loaded = await loadRecipeSpec({
      workspaceRoot: root,
      idOrPath: 'smoke',
    });
    expect(loaded.id).toBe('smoke');
    expect(renderRecipePrompt(loaded, { word: 'hi' })).toBe('Say hi');
  });

  it('writingRecipeToSpec stays ask mode with force skills', () => {
    const spec = writingRecipeToSpec('commit-message');
    expect(spec.mode).toBe('ask');
    expect(spec.requiredSkillIds).toContain('git-commit-message');
    expect(spec.writingRecipe).toBe('commit-message');
  });
});
