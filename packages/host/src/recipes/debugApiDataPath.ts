/**
 * Host recipe: debug empty/wrong API responses with live API + DB probes.
 *
 * Compiles to agent mode + force-attached `api-db-runtime-debug` skill.
 * Decision Policy still owns ToolGrant (never widened here).
 */

import {
  compileRecipeToStartInput,
  recipeSpecSchema,
  type CompiledRecipeStart,
  type CompileRecipeOptions,
  type RecipeSpec,
} from './recipeSpec.js';

export const DEBUG_API_DATA_PATH_SKILL_ID = 'api-db-runtime-debug';

export const DEBUG_API_DATA_PATH_RECIPE_ID = 'debug-api-data-path' as const;

export type DebugApiDataPathParams = {
  /** API path or full URL path, e.g. /v2/api/users */
  endpoint: string;
  /** Table or entity name, e.g. users */
  tableOrEntity: string;
  /** Optional API origin, e.g. http://localhost:3000 */
  baseUrl?: string;
};

/**
 * Built-in RecipeSpec for data-path debugging.
 */
export function debugApiDataPathToSpec(): RecipeSpec {
  return recipeSpecSchema.parse({
    schemaVersion: 1,
    id: DEBUG_API_DATA_PATH_RECIPE_ID,
    title: 'Debug API + DB data path',
    description:
      'Probe API then DB schema/data before fixing empty or wrong API responses.',
    mode: 'agent',
    requiredSkillIds: [DEBUG_API_DATA_PATH_SKILL_ID],
    promptTemplate: `Symptom: the API returns empty or wrong data for {{endpoint}}.

Base URL (optional): {{baseUrl}}
Entity / table: {{tableOrEntity}}

Use systematic API + DB runtime evidence (skill api-db-runtime-debug):

1. Probe the API (status + body). Treat 200 with an empty list as a semantic failure.
2. Probe DB schema (tables / migrations for {{tableOrEntity}}).
3. Probe DB data (COUNT + sample rows, read-only — prefer mcp__sqlite__* or mcp__postgres__*).
4. Fill an evidence ledger for: no data, DB not initialized, adapter not connected, DTO/mapping, config/pull wiring.
5. Do not apply_patch until API and DB probes are recorded.
6. Fix only the surviving hypothesis; re-probe the API to verify.

Stay on the failing data path. No drive-by refactors.`,
    params: [
      {
        name: 'endpoint',
        description: 'API path that returns empty/wrong data (e.g. /v2/api/users)',
        required: true,
      },
      {
        name: 'tableOrEntity',
        description: 'Database table or entity name (e.g. users)',
        required: true,
      },
      {
        name: 'baseUrl',
        description: 'Optional API origin (e.g. http://localhost:3000)',
        required: false,
        default: '',
      },
    ],
  });
}

/**
 * Compile the debug-api-data-path recipe into MitiiStartInput-shaped fields.
 */
export async function buildDebugApiDataPathAsk(
  params: DebugApiDataPathParams,
  options: Pick<CompileRecipeOptions, 'workspaceRoot' | 'userNote'> = {
    workspaceRoot: process.cwd(),
  },
): Promise<CompiledRecipeStart> {
  return compileRecipeToStartInput(debugApiDataPathToSpec(), {
    workspaceRoot: options.workspaceRoot,
    params: {
      endpoint: params.endpoint,
      tableOrEntity: params.tableOrEntity,
      baseUrl: params.baseUrl ?? '',
    },
    ...(options.userNote ? { userNote: options.userNote } : {}),
  });
}

export function isDebugApiDataPathRecipeId(id: string): boolean {
  return id.trim() === DEBUG_API_DATA_PATH_RECIPE_ID;
}
