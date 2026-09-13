import { describe, expect, it } from 'vitest';

import {
  MITII_WRITING_RECIPE_IDS,
  isMitiiWritingRecipeId,
  resolveMitiiWritingRecipe,
  unwrapRecipeAnswer,
} from './gitWritingRecipes.js';

describe('git writing recipes', () => {
  it('resolves recipe ids and CLI command aliases', () => {
    expect(isMitiiWritingRecipeId('commit-message')).toBe(true);
    expect(isMitiiWritingRecipeId('nope')).toBe(false);

    expect(resolveMitiiWritingRecipe('commit-message')).toMatchObject({
      skillId: 'git-commit-message',
      command: 'commit-message',
    });
    expect(resolveMitiiWritingRecipe('pr-summary')?.skillId).toBe(
      'git-pr-summary',
    );
    expect(resolveMitiiWritingRecipe('changelog')?.skillId).toBe(
      'release-changelog',
    );
    expect(resolveMitiiWritingRecipe('missing')).toBeUndefined();
  });

  it('exposes the three shipping recipe ids', () => {
    expect([...MITII_WRITING_RECIPE_IDS]).toEqual([
      'commit-message',
      'pr-summary',
      'changelog',
    ]);
  });

  it('unwraps fenced model answers', () => {
    expect(unwrapRecipeAnswer('feat: hello')).toBe('feat: hello');
    expect(unwrapRecipeAnswer('```\nfeat: hello\n```')).toBe('feat: hello');
    expect(unwrapRecipeAnswer('```text\nfix: x\n\nbody\n```')).toBe(
      'fix: x\n\nbody',
    );
  });
});
