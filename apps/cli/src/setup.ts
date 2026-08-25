import {
  PROVIDER_PRESETS,
  getProviderPreset,
  resolveProviderApiKey,
  testProviderConnection,
  type ProviderPreset,
  type ProviderPresetId,
} from '@mitii/host';

import {
  loadMitiiHostConfig,
  saveMitiiHostConfig,
  type MitiiHostConfig,
} from './config.js';
import type { SessionIo } from './session.js';

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
}

const SETUP_PRESETS = PROVIDER_PRESETS.filter((p) => p.id !== 'echo');

function envHintForPreset(preset: ProviderPreset): string | undefined {
  if (!preset.requiresApiKey) return undefined;
  if (preset.type === 'anthropic') {
    return 'export ANTHROPIC_API_KEY=sk-ant-...';
  }
  if (preset.type === 'gemini') {
    return 'export GEMINI_API_KEY=...';
  }
  if (preset.id === 'openai') {
    return 'export OPENAI_API_KEY=sk-...';
  }
  if (preset.id === 'deepseek' || preset.id === 'openrouter') {
    return 'export MITII_API_KEY=...   # or OPENAI_API_KEY';
  }
  return 'export MITII_API_KEY=...   # or OPENAI_API_KEY';
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

/**
 * Interactive / flag-driven provider setup. Writes non-secret config only.
 */
export async function runSetup(options: SetupOptions): Promise<number> {
  const { io } = options;
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

  if (options.provider) {
    preset = resolvePreset(options.provider);
    if (!preset) {
      io.writeStderr(
        `mitii setup: unknown provider "${options.provider}"\n` +
          `Known: ${PROVIDER_PRESETS.map((p) => p.id).join(', ')}\n`,
      );
      return 2;
    }
  } else if (!options.yes) {
    io.writeStdout('Mitii model setup\n');
    io.writeStdout(
      'Config stores provider/model only. API keys stay in the environment.\n\n',
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

  if (!model) {
    const suggestions = preset.models?.length
      ? preset.models
      : [preset.model];
    if (!options.yes && suggestions.length > 0) {
      io.writeStdout('\nSuggested models:\n');
      suggestions.forEach((m, i) => {
        io.writeStdout(`  ${String(i + 1).padStart(2)}. ${m}\n`);
      });
      const answer = (
        await io.prompt(
          `Model [${preset.model}] (number, id, or Enter for default): `,
        )
      ).trim();
      if (!answer) {
        model = preset.model;
      } else {
        const asIndex = Number.parseInt(answer, 10);
        if (
          Number.isFinite(asIndex) &&
          asIndex >= 1 &&
          asIndex <= suggestions.length
        ) {
          model = suggestions[asIndex - 1]!;
        } else {
          model = answer;
        }
      }
    } else {
      model = preset.model;
    }
  }

  if (!baseUrl) {
    if (
      !options.yes &&
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

  if (!options.yes && !options.mode) {
    const modeAnswer = (
      await io.prompt(`Default mode ask|plan|agent [${mode}]: `)
    )
      .trim()
      .toLowerCase();
    if (modeAnswer === 'ask' || modeAnswer === 'plan' || modeAnswer === 'agent') {
      mode = modeAnswer;
    }
  }

  const config: MitiiHostConfig = {
    provider: preset.type,
    providerPreset: preset.id as ProviderPresetId,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    defaultMode: mode,
  };

  if (!options.yes) {
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
  if (hint) {
    io.writeStdout('\nNext — set an API key in your shell (not in the file):\n');
    io.writeStdout(`  ${hint}\n`);
  } else {
    io.writeStdout(
      '\nLocal provider — no API key needed if the server is running.\n',
    );
  }

  io.writeStdout('\nThen try:\n');
  io.writeStdout('  mitii session\n');
  io.writeStdout('  mitii ask "What does this repo do?"\n');

  if (options.test) {
    const apiKey = resolveProviderApiKey({ type: preset.type });
    io.writeStderr('\nTesting connection…\n');
    const result = await testProviderConnection({
      type: preset.type,
      model: model ?? preset.model,
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
    });
    if (result.ok) {
      io.writeStdout(`Connection OK: ${result.message}\n`);
      return 0;
    }
    io.writeStderr(`Connection failed: ${result.message}\n`);
    return 1;
  }

  return 0;
}
