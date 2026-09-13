import type { SessionIo } from '../session.js';
import { runAsk } from '../runAskCommand.js';
import {
  compileRecipeToStartInput,
  isMitiiWritingRecipeId,
  loadRecipeSpec,
  writingRecipeToSpec,
} from '@mitii/host';

/**
 * `mitii recipe run <id> [--param k=v ...] [--preview] [note]`
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
  if (sub !== 'run') {
    io.writeStderr(
      'Usage: mitii recipe run <id|path> [--param key=value]... [--preview] [note]\n',
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
