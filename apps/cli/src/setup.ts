import {
  PROVIDER_PRESETS,
  getProviderPreset,
  listProviderModels,
  resolveProviderApiKey,
  testProviderConnection,
  type ListProviderModelsInput,
  type ProviderConnectionResult,
  type ProviderPreset,
  type ProviderPresetId,
  type TestProviderConnectionInput,
} from '@mitii/host';

import {
  loadMitiiHostConfig,
  saveMitiiHostConfig,
  type MitiiHostConfig,
} from './config.js';
import { formatLoopPolicySummary } from './loopPolicy.js';
import type { SessionIo } from './session.js';
import {
  preferredApiKeyEnvName,
  upsertDotEnvKey,
} from './setupEnvKeys.js';

export interface SetupOptions {
  cwd: string;
  /** Write to ~/.mitii/config.json instead of project .mitii/ */
  global?: boolean;
  /** Print resolved config without prompting. */
  show?: boolean;
  /** Non-interactive preset id (ollama, anthropic, …). */
  provider?: string;
  model?: string;
  baseUrl?: string;
  mode?: 'ask' | 'plan' | 'agent';
  /** Probe the provider after writing config. */
  test?: boolean;
  /** Skip confirmation prompts when flags are complete. */
  yes?: boolean;
  io: SessionIo;
  /** Injectable env (tests). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  listModels?: (
    input: ListProviderModelsInput,
  ) => Promise<string[]>;
  testConnection?: (
    input: TestProviderConnectionInput,
  ) => Promise<ProviderConnectionResult>;
  writeEnvKey?: typeof upsertDotEnvKey;
}

const SETUP_PRESETS = PROVIDER_PRESETS.filter((p) => p.id !== 'echo');

function envHintForPreset(preset: ProviderPreset): string | undefined {
  if (!preset.requiresApiKey) return undefined;
  const name = preferredApiKeyEnvName(preset);
  if (preset.type === 'anthropic') {
    return `export ${name}=sk-ant-...`;
  }
  if (preset.type === 'gemini') {
    return `export ${name}=...`;
  }
  if (preset.id === 'openai') {
    return `export ${name}=sk-...`;
  }
  return `export ${name}=...   # or OPENAI_API_KEY`;
}

function formatConfigSummary(
  config: MitiiHostConfig,
  pathHint?: string,
): string {
  const lines = [
    'Current Mitii host config (no secrets):',
    pathHint ? `  file       ${pathHint}` : undefined,
    `  provider   ${config.provider ?? '(unset → echo if no key)'}`,
    `  preset     ${config.providerPreset ?? '(none)'}`,
    `  model      ${config.model ?? '(preset default)'}`,
    `  baseUrl    ${config.baseUrl ?? '(preset default)'}`,
    `  mode       ${config.defaultMode ?? 'ask'}`,
    formatLoopPolicySummary(config.loopPolicy),
  ].filter(Boolean) as string[];
  return `${lines.join('\n')}\n`;
}

function resolvePreset(idOrType: string): ProviderPreset | undefined {
  return getProviderPreset(idOrType);
}

async function promptChoice(
  io: SessionIo,
  question: string,
  choices: readonly string[],
): Promise<string | undefined> {
  for (;;) {
    const answer = (await io.prompt(question)).trim();
    if (!answer) return undefined;
    const asIndex = Number.parseInt(answer, 10);
    if (
      Number.isFinite(asIndex) &&
      asIndex >= 1 &&
      asIndex <= choices.length
    ) {
      return choices[asIndex - 1];
    }
    if (choices.includes(answer)) return answer;
    io.writeStderr(
      `  Pick 1–${choices.length} or a listed id. Empty cancels.\n`,
    );
  }
}

function uniqueNonEmpty(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

async function resolveApiKeyForSetup(params: {
  preset: ProviderPreset;
  interactive: boolean;
  cwd: string;
  global?: boolean;
  env: NodeJS.ProcessEnv;
  io: SessionIo;
  writeEnvKey: typeof upsertDotEnvKey;
}): Promise<{ apiKey?: string; cancelled?: boolean }> {
  const { preset, io, env } = params;
  if (!preset.requiresApiKey) {
    return {
      apiKey: resolveProviderApiKey({ type: preset.type, env }),
    };
  }

  const envName = preferredApiKeyEnvName(preset);
  const existing = resolveProviderApiKey({ type: preset.type, env });

  if (!params.interactive) {
    if (!existing) {
      io.writeStderr(
        `Warning: ${preset.label} needs ${envName} in the environment (or .mitii/.env).\n`,
      );
    }
    return { apiKey: existing };
  }

  if (existing) {
    io.writeStdout(
      `\nAPI key: using existing ${envName} from environment / .env\n`,
    );
    const replace = (
      await io.prompt(
        'Paste a new key to replace, or Enter to keep: ',
      )
    ).trim();
    if (!replace) return { apiKey: existing };
    const path = params.writeEnvKey({
      cwd: params.cwd,
      global: params.global,
      key: envName,
      value: replace,
    });
    env[envName] = replace;
    io.writeStdout(`Saved ${envName} → ${path}\n`);
    return { apiKey: replace };
  }

  io.writeStdout(
    `\n${preset.label} requires an API key (stored in .mitii/.env — never config.json).\n`,
  );
  const entered = (await io.prompt(`${envName}: `)).trim();
  if (!entered) {
    io.writeStderr('setup cancelled — API key required\n');
    return { cancelled: true };
  }
  const path = params.writeEnvKey({
    cwd: params.cwd,
    global: params.global,
    key: envName,
    value: entered,
  });
  env[envName] = entered;
  io.writeStdout(`Saved ${envName} → ${path}\n`);
  return { apiKey: entered };
}

async function resolveModelForSetup(params: {
  preset: ProviderPreset;
  interactive: boolean;
  modelFlag?: string;
  baseUrl?: string;
  apiKey?: string;
  io: SessionIo;
  listModels: (
    input: ListProviderModelsInput,
  ) => Promise<string[]>;
}): Promise<{ model?: string; cancelled?: boolean }> {
  const { preset, io } = params;
  if (params.modelFlag?.trim()) {
    return { model: params.modelFlag.trim() };
  }

  let discovered: string[] = [];
  if (params.interactive || !preset.model) {
    io.writeStdout('\nFetching models…\n');
    try {
      discovered = await params.listModels({
        type: preset.type,
        ...(params.baseUrl ? { baseUrl: params.baseUrl } : {}),
        ...(params.apiKey ? { apiKey: params.apiKey } : {}),
      });
    } catch (error) {
      io.writeStderr(
        `  Could not list models: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  const suggestions = uniqueNonEmpty([
    ...discovered,
    ...(preset.models ?? []),
    preset.model,
  ]);

  if (!params.interactive) {
    const fallback = preset.model.trim() || suggestions[0];
    return { model: fallback || undefined };
  }

  if (suggestions.length > 0) {
    io.writeStdout('\nAvailable models:\n');
    const shown = suggestions.slice(0, 40);
    shown.forEach((m, i) => {
      io.writeStdout(`  ${String(i + 1).padStart(2)}. ${m}\n`);
    });
    if (suggestions.length > shown.length) {
      io.writeStdout(
        `  … ${suggestions.length - shown.length} more (type a full model id)\n`,
      );
    }
    const defaultLabel = preset.model.trim() || shown[0]!;
    for (;;) {
      const answer = (
        await io.prompt(
          `Model [${defaultLabel}] (number, id, or Enter for default): `,
        )
      ).trim();
      if (!answer) {
        return { model: defaultLabel };
      }
      const asIndex = Number.parseInt(answer, 10);
      if (
        Number.isFinite(asIndex) &&
        asIndex >= 1 &&
        asIndex <= shown.length
      ) {
        return { model: shown[asIndex - 1]! };
      }
      if (answer) return { model: answer };
    }
  }

  io.writeStdout(
    '\nNo models discovered. Enter a model id from your provider console.\n',
  );
  for (;;) {
    const answer = (await io.prompt('Model id (required): ')).trim();
    if (answer) return { model: answer };
    io.writeStderr('  Model id is required. Empty cancels.\n');
    const again = (await io.prompt('Cancel setup? [y/N]: ')).trim().toLowerCase();
    if (again === 'y' || again === 'yes') {
      return { cancelled: true };
    }
  }
}

/**
 * Interactive / flag-driven provider setup. Writes non-secret config only.
 * API keys are prompted when required and stored in `.mitii/.env` (or `~/.mitii/.env` with --global).
 */
export async function runSetup(options: SetupOptions): Promise<number> {
  const { io } = options;
  const env = options.env ?? process.env;
  const listModels = options.listModels ?? listProviderModels;
  const testConnection = options.testConnection ?? testProviderConnection;
  const writeEnvKey = options.writeEnvKey ?? upsertDotEnvKey;
  const existing = loadMitiiHostConfig(options.cwd);

  if (options.show) {
    io.writeStdout(formatConfigSummary(existing));
    io.writeStderr(
      '\nAPI keys stay in the environment — never in config files.\n',
    );
    if (!existing.provider && !existing.providerPreset) {
      io.writeStderr('Tip: run  mitii setup  to choose a provider.\n');
    }
    return 0;
  }

  let preset: ProviderPreset | undefined;
  let model = options.model?.trim();
  let baseUrl = options.baseUrl?.trim();
  let mode = options.mode ?? existing.defaultMode ?? 'ask';
  const interactive = !options.yes;

  if (options.provider) {
    preset = resolvePreset(options.provider);
    if (!preset) {
      io.writeStderr(
        `mitii setup: unknown provider "${options.provider}"\n` +
          `Known: ${PROVIDER_PRESETS.map((p) => p.id).join(', ')}\n`,
      );
      return 2;
    }
  } else if (interactive) {
    io.writeStdout('Mitii model setup\n');
    io.writeStdout(
      'Config stores provider/model only. API keys stay in .env / the environment.\n\n',
    );
    SETUP_PRESETS.forEach((p, i) => {
      const key = p.requiresApiKey ? 'key required' : 'no key';
      io.writeStdout(
        `  ${String(i + 1).padStart(2)}. ${p.id.padEnd(18)} ${p.label}  (${key})\n`,
      );
    });
    io.writeStdout('\n');
    const ids = SETUP_PRESETS.map((p) => p.id);
    const picked = await promptChoice(
      io,
      'Provider number or id (empty = cancel): ',
      ids,
    );
    if (!picked) {
      io.writeStderr('setup cancelled\n');
      return 1;
    }
    preset = resolvePreset(picked);
  } else {
    io.writeStderr(
      'mitii setup: pass --provider <id> with --yes, or run interactively\n',
    );
    return 2;
  }

  if (!preset) {
    io.writeStderr('mitii setup: no provider selected\n');
    return 2;
  }

  if (!baseUrl) {
    if (
      interactive &&
      (preset.id === 'openai-compatible' ||
        preset.id === 'azure-openai' ||
        preset.baseUrl.includes('YOUR_'))
    ) {
      const answer = (
        await io.prompt(`Base URL [${preset.baseUrl}]: `)
      ).trim();
      baseUrl = answer || preset.baseUrl;
    } else if (preset.baseUrl) {
      baseUrl = preset.baseUrl;
    }
  }

  const keyResult = await resolveApiKeyForSetup({
    preset,
    interactive,
    cwd: options.cwd,
    global: options.global,
    env,
    io,
    writeEnvKey,
  });
  if (keyResult.cancelled) return 1;
  const apiKey = keyResult.apiKey;

  if (!model) {
    const modelResult = await resolveModelForSetup({
      preset,
      interactive,
      modelFlag: options.model,
      baseUrl,
      apiKey,
      io,
      listModels,
    });
    if (modelResult.cancelled) {
      io.writeStderr('setup cancelled\n');
      return 1;
    }
    model = modelResult.model;
  }

  if (interactive && !options.mode) {
    const modeAnswer = (
      await io.prompt(`Default mode ask|plan|agent [${mode}]: `)
    )
      .trim()
      .toLowerCase();
    if (
      modeAnswer === 'ask' ||
      modeAnswer === 'plan' ||
      modeAnswer === 'agent'
    ) {
      mode = modeAnswer;
    }
  }

  const config: MitiiHostConfig = {
    provider: preset.type,
    providerPreset: preset.id as ProviderPresetId,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    defaultMode: mode,
  };

  if (interactive) {
    io.writeStdout('\nWill write:\n');
    io.writeStdout(
      formatConfigSummary(
        config,
        options.global ? '~/.mitii/config.json' : '.mitii/config.json',
      ),
    );
    const confirm = (
      await io.prompt('Write this config? [Y/n]: ')
    )
      .trim()
      .toLowerCase();
    if (confirm === 'n' || confirm === 'no') {
      io.writeStderr('setup cancelled\n');
      return 1;
    }
  }

  const path = saveMitiiHostConfig(config, {
    cwd: options.cwd,
    global: options.global === true,
  });
  io.writeStdout(`Wrote ${path}\n`);

  const hint = envHintForPreset(preset);
  if (hint && !apiKey) {
    io.writeStdout('\nNext — set an API key in your shell (not in the file):\n');
    io.writeStdout(`  ${hint}\n`);
  } else if (!preset.requiresApiKey) {
    io.writeStdout(
      '\nLocal provider — no API key needed if the server is running.\n',
    );
  }

  io.writeStdout('\nThen try:\n');
  io.writeStdout('  mitii session\n');
  io.writeStdout('  mitii ask "What does this repo do?"\n');

  let shouldTest = options.test === true;
  if (interactive && !options.test) {
    const answer = (
      await io.prompt('\nTest connection now? [Y/n]: ')
    )
      .trim()
      .toLowerCase();
    shouldTest = answer !== 'n' && answer !== 'no';
  }

  if (shouldTest) {
    const resolvedKey =
      apiKey ?? resolveProviderApiKey({ type: preset.type, env });
    io.writeStderr('\nTesting connection…\n');
    const result = await testConnection({
      type: preset.type,
      model: model ?? preset.model,
      ...(baseUrl ? { baseUrl } : {}),
      ...(resolvedKey ? { apiKey: resolvedKey } : {}),
    });
    if (result.ok) {
      io.writeStdout(`Connection OK: ${result.message}\n`);
      if (result.models?.length && !model) {
        io.writeStdout(
          `Models available: ${result.models.slice(0, 8).join(', ')}${result.models.length > 8 ? ', …' : ''}\n`,
        );
      }
      return 0;
    }
    io.writeStderr(`Connection failed: ${result.message}\n`);
    return 1;
  }

  return 0;
}
