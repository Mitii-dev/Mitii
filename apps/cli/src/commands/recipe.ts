import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionIo } from '../session.js';
import { runAsk } from '../runAskCommand.js';
import {
  MITII_WRITING_RECIPES,
  compileRecipeToStartInput,
  isMitiiWritingRecipeId,
  loadRecipeSpec,
  writingRecipeToSpec,
} from '@mitii/host';

/**
 * `mitii recipe list|show <id>|run <id> [--param k=v ...] [--preview] [note]`
 * Compiles RecipeSpec → MitiiStartInput fields; never widens ToolGrant.
 */
export async function runRecipeCommand(params: {
  args: string[];
  cwd: string;
  json?: boolean;
  forceEcho?: boolean;
  io: SessionIo;
}): Promise<number> {
  const { args, cwd, json, forceEcho, io } = params;
  const [sub = '', ...rest] = args;

  if (sub === 'list' || sub === 'ls') {
    return listRecipes({ cwd, json: json === true, io });
  }
  if (sub === 'show') {
    const idOrPath = rest.find((a) => !a.startsWith('-'));
    if (!idOrPath) {
      io.writeStderr('Usage: mitii recipe show <id|path>\n');
      return 2;
    }
    return showRecipe({ cwd, idOrPath, json: json === true, io });
  }

  if (sub !== 'run') {
    io.writeStderr(
      'Usage: mitii recipe list|show <id>|run <id|path> [--param key=value]... [--preview] [note]\n',
    );
    return 2;
  }

  const paramValues: Record<string, string> = {};
  const positionals: string[] = [];
  let previewOnly = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--param') {
      const raw = rest[i + 1];
      if (!raw || raw.startsWith('-')) {
        io.writeStderr('mitii recipe: --param requires key=value\n');
        return 2;
      }
      const eq = raw.indexOf('=');
      if (eq <= 0) {
        io.writeStderr(
          `mitii recipe: invalid --param "${raw}" (want key=value)\n`,
        );
        return 2;
      }
      paramValues[raw.slice(0, eq)] = raw.slice(eq + 1);
      i += 1;
      continue;
    }
    if (arg === '--preview') {
      previewOnly = true;
      continue;
    }
    if (arg.startsWith('-')) {
      io.writeStderr(`mitii recipe: unknown option "${arg}"\n`);
      return 2;
    }
    positionals.push(arg);
  }

  const idOrPath = positionals[0];
  if (!idOrPath) {
    io.writeStderr('mitii recipe run requires a recipe id or path\n');
    return 2;
  }
  const userNote = positionals.slice(1).join(' ').trim() || undefined;

  let spec;
  try {
    if (isMitiiWritingRecipeId(idOrPath)) {
      spec = writingRecipeToSpec(idOrPath);
    } else {
      spec = await loadRecipeSpec({ workspaceRoot: cwd, idOrPath });
    }
  } catch (error) {
    io.writeStderr(
      `mitii recipe: failed to load "${idOrPath}": ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return 2;
  }

  let compiled;
  try {
    compiled = await compileRecipeToStartInput(spec, {
      workspaceRoot: cwd,
      params: paramValues,
      userNote,
    });
  } catch (error) {
    io.writeStderr(
      `mitii recipe: compile failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return 2;
  }

  if (previewOnly) {
    io.writeStdout(`${JSON.stringify(compiled, null, 2)}\n`);
    return 0;
  }

  const { code } = await runAsk({
    cwd,
    prompt: compiled.prompt,
    mode: compiled.mode,
    requiredSkillIds: compiled.requiredSkillIds,
    autonomyPreset: compiled.autonomyPreset,
    json: json === true,
    forceEcho: forceEcho === true,
    io,
    origin: compiled.autonomyPreset ? 'automation' : 'user',
  });
  return code;
}

function listRecipes(options: {
  cwd: string;
  json: boolean;
  io: SessionIo;
}): number {
  const dir = join(options.cwd, '.mitii', 'recipes');
  const project: Array<{ id: string; path: string; source: 'project' }> = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.replace(/\.json$/, '');
      project.push({ id, path: join(dir, name), source: 'project' });
    }
  }
  const builtin = MITII_WRITING_RECIPES.map((r) => ({
    id: r.id,
    title: r.title,
    skillId: r.skillId,
    command: r.command,
    source: 'builtin' as const,
  }));

  if (options.json) {
    options.io.writeStdout(
      `${JSON.stringify({ builtin, project, recipesDir: dir }, null, 2)}\n`,
    );
    return 0;
  }

  options.io.writeStdout('Built-in writing recipes\n');
  for (const r of builtin) {
    options.io.writeStdout(
      `  ${r.id.padEnd(16)}  mitii ${r.command}  (skill ${r.skillId})\n`,
    );
  }
  options.io.writeStdout(`\nProject recipes (.mitii/recipes/)\n`);
  if (project.length === 0) {
    options.io.writeStdout('  (none)\n');
  } else {
    for (const r of project) {
      options.io.writeStdout(`  ${r.id.padEnd(16)}  ${r.path}\n`);
    }
  }
  options.io.writeStdout(
    '\nRun: mitii recipe run <id>   Show: mitii recipe show <id>   Preview: mitii recipe run <id> --preview\n',
  );
  return 0;
}

async function showRecipe(options: {
  cwd: string;
  idOrPath: string;
  json: boolean;
  io: SessionIo;
}): Promise<number> {
  try {
    const spec = isMitiiWritingRecipeId(options.idOrPath)
      ? writingRecipeToSpec(options.idOrPath)
      : await loadRecipeSpec({
          workspaceRoot: options.cwd,
          idOrPath: options.idOrPath,
        });
    options.io.writeStdout(`${JSON.stringify(spec, null, 2)}\n`);
    return 0;
  } catch (error) {
    options.io.writeStderr(
      `mitii recipe show: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return 2;
  }
}
