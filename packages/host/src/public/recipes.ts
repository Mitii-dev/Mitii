/** Recipes — force-attach bundled skills for commit, PR, changelog, review-fix, and debug flows. */

export {
  MITII_WRITING_RECIPE_IDS,
  MITII_WRITING_RECIPES,
  buildWritingRecipeAsk,
  collectGitWritingContext,
  isMitiiWritingRecipeId,
  resolveMitiiWritingRecipe,
  unwrapRecipeAnswer,
} from '../recipes/gitWritingRecipes.js';
export type {
  BuildWritingRecipeAskOptions,
  CommitMessageStyle,
  MitiiWritingRecipe,
  MitiiWritingRecipeId,
  WritingRecipeAsk,
} from '../recipes/gitWritingRecipes.js';

export {
  RECIPE_SPEC_SCHEMA_VERSION,
  recipeSpecSchema,
  compileRecipeToStartInput,
  loadRecipeSpec,
  renderRecipePrompt,
  writingRecipeToSpec,
} from '../recipes/recipeSpec.js';
export type {
  RecipeSpec,
  CompiledRecipeStart,
  CompileRecipeOptions,
} from '../recipes/recipeSpec.js';

// Review → Agent fix recipe (host-owned; V8 review stays diagnose-only)
export {
  FIX_REVIEW_FINDINGS_RECIPE_ID,
  FIX_REVIEW_FINDINGS_SKILL_ID,
  buildFixReviewFindingsAsk,
} from '../recipes/fixReviewFindings.js';
export type {
  BuildFixReviewFindingsAskOptions,
  FixReviewFindingInput,
  FixReviewFindingsAsk,
} from '../recipes/fixReviewFindings.js';

// API + DB data-path debug recipe
export {
  DEBUG_API_DATA_PATH_RECIPE_ID,
  DEBUG_API_DATA_PATH_SKILL_ID,
  buildDebugApiDataPathAsk,
  debugApiDataPathToSpec,
  isDebugApiDataPathRecipeId,
} from '../recipes/debugApiDataPath.js';
export type { DebugApiDataPathParams } from '../recipes/debugApiDataPath.js';
