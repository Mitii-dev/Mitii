import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  buildWritingRecipeAsk,
  isMitiiWritingRecipeId,
  type CommitMessageStyle,
  type MitiiWritingRecipeId,
} from './gitWritingRecipes.js';

/**
 * Parameterized recipe product surface (Phase 2).
 * Compiles to MitiiStartInput fields only — never widens ToolGrant.
 */
export const RECIPE_SPEC_SCHEMA_VERSION = 1 as const;

export const recipeSpecSchema = z
  .object({
    schemaVersion: z.literal(RECIPE_SPEC_SCHEMA_VERSION),
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    description: z.string().max(2_000).optional(),
    /** Interaction mode ceiling for the compiled start input. */
    mode: z.enum(['ask', 'plan', 'agent']).default('ask'),
    /** Autonomy preset for automation / unattended runs. */
    autonomyPreset: z
      .enum(['readonly', 'propose', 'apply', 'apply_and_pr'])
      .optional(),
    /** Force-attached skill ids (Decision Policy still owns grants). */
    requiredSkillIds: z.array(z.string().min(1).max(64)).max(3).default([]),
    /**
     * Prompt template. Params substitute `{{name}}` placeholders.
     * Missing required params fail compile (no silent empty).
     */
    promptTemplate: z.string().min(1).max(50_000),
    params: z
      .array(
        z
          .object({
            name: z.string().min(1).max(64),
            description: z.string().max(500).optional(),
            required: z.boolean().default(false),
            default: z.string().max(4_000).optional(),
          })
          .strict(),
      )
      .max(32)
      .default([]),
    /** Optional built-in writing recipe to gather git context first. */
    writingRecipe: z
      .enum(['commit-message', 'pr-summary', 'changelog'])
      .optional(),
  })
  .strict();

export type RecipeSpec = z.infer<typeof recipeSpecSchema>;

export interface CompiledRecipeStart {
  recipeId: string;
  title: string;
  prompt: string;
  mode: 'ask' | 'plan' | 'agent';
  requiredSkillIds: string[];
  autonomyPreset?: 'readonly' | 'propose' | 'apply' | 'apply_and_pr';
  /** Label for CLI / logs. */
  label: string;
}

export interface CompileRecipeOptions {
  workspaceRoot: string;
  /** Param values from CLI `--param k=v` or host UI. */
  params?: Readonly<Record<string, string>>;
  /** Extra note appended after the rendered template. */
  userNote?: string;
  /** Commit-message style when compiling a writing recipe. */
  commitMessageStyle?: CommitMessageStyle;
}

/**
 * Render `{{param}}` placeholders. Throws if a required param is missing
 * and has no default.
 */
export function renderRecipePrompt(
  spec: RecipeSpec,
  params: Readonly<Record<string, string>> = {},
): string {
  const resolved: Record<string, string> = { ...params };
  for (const param of spec.params) {
    if (resolved[param.name] === undefined || resolved[param.name] === '') {
      if (param.default !== undefined) {
        resolved[param.name] = param.default;
      } else if (param.required) {
        throw new Error(
          `Recipe "${spec.id}" requires param "${param.name}".`,
        );
      } else {
        resolved[param.name] = '';
      }
    }
  }

  return spec.promptTemplate.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key: string) => {
    return resolved[key] ?? '';
  });
}

/**
 * Compile a RecipeSpec into MitiiStartInput-shaped fields.
 * Never sets allowedTools / ToolGrant — Decision Policy remains authority.
 */
export async function compileRecipeToStartInput(
  spec: RecipeSpec,
  options: CompileRecipeOptions,
): Promise<CompiledRecipeStart> {
  const parsed = recipeSpecSchema.parse(spec);
  let prompt = renderRecipePrompt(parsed, options.params);
  let requiredSkillIds = [...parsed.requiredSkillIds];

  if (parsed.writingRecipe && isMitiiWritingRecipeId(parsed.writingRecipe)) {
    const writing = await buildWritingRecipeAsk({
      workspaceRoot: options.workspaceRoot,
      recipe: parsed.writingRecipe as MitiiWritingRecipeId,
      userNote: prompt,
      ...(options.commitMessageStyle
        ? { commitMessageStyle: options.commitMessageStyle }
        : {}),
    });
    prompt = writing.prompt;
    requiredSkillIds = [
      ...new Set([...requiredSkillIds, ...writing.requiredSkillIds]),
    ].slice(0, 3);
  }

  if (options.userNote?.trim()) {
    prompt = `${prompt.trim()}\n\n## Note\n${options.userNote.trim()}\n`;
  }

  return {
    recipeId: parsed.id,
    title: parsed.title,
    prompt,
    mode: parsed.mode,
    requiredSkillIds,
    ...(parsed.autonomyPreset
      ? { autonomyPreset: parsed.autonomyPreset }
      : {}),
    label: `recipe:${parsed.id}`,
  };
}

/**
 * Load a RecipeSpec from `.mitii/recipes/<id>.json` or an absolute/relative path.
 */
export async function loadRecipeSpec(params: {
  workspaceRoot: string;
  idOrPath: string;
}): Promise<RecipeSpec> {
  const { workspaceRoot, idOrPath } = params;
  const trimmed = idOrPath.trim();
  if (!trimmed) {
    throw new Error('Recipe id/path must be non-empty.');
  }

  const path = trimmed.includes('/') || trimmed.endsWith('.json')
    ? trimmed.startsWith('/')
      ? trimmed
      : join(workspaceRoot, trimmed)
    : join(workspaceRoot, '.mitii', 'recipes', `${trimmed}.json`);

  const raw = await readFile(path, 'utf8');
  const parsed = recipeSpecSchema.parse(JSON.parse(raw));
  if (
    !trimmed.includes('/') &&
    !trimmed.endsWith('.json') &&
    parsed.id !== trimmed &&
    basename(path, '.json') !== trimmed
  ) {
    // Allow file basename mismatch only when ids match.
  }
  return parsed;
}

/** Built-in writing recipes as RecipeSpec documents (shareable format). */
export function writingRecipeToSpec(id: MitiiWritingRecipeId): RecipeSpec {
  const byId: Record<MitiiWritingRecipeId, RecipeSpec> = {
    'commit-message': recipeSpecSchema.parse({
      schemaVersion: 1,
      id: 'commit-message',
      title: 'Git commit message',
      mode: 'ask',
      requiredSkillIds: ['git-commit-message'],
      writingRecipe: 'commit-message',
      promptTemplate: '{{note}}',
      params: [
        {
          name: 'note',
          description: 'Optional extra guidance for the commit message',
          required: false,
          default: '',
        },
      ],
    }),
    'pr-summary': recipeSpecSchema.parse({
      schemaVersion: 1,
      id: 'pr-summary',
      title: 'Git PR summary',
      mode: 'ask',
      requiredSkillIds: ['git-pr-summary'],
      writingRecipe: 'pr-summary',
      promptTemplate: '{{note}}',
      params: [
        {
          name: 'note',
          description: 'Optional extra guidance',
          required: false,
          default: '',
        },
      ],
    }),
    changelog: recipeSpecSchema.parse({
      schemaVersion: 1,
      id: 'changelog',
      title: 'Release changelog',
      mode: 'ask',
      requiredSkillIds: ['release-changelog'],
      writingRecipe: 'changelog',
      promptTemplate: '{{note}}',
      params: [
        {
          name: 'note',
          description: 'Optional extra guidance',
          required: false,
          default: '',
        },
      ],
    }),
  };
  return byId[id];
}
