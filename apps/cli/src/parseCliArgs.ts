import type {
  AgentMode,
  MitiiAutonomyPreset,
  UserRequestOrigin,
} from '@mitii/sdk';

export interface ParsedCliArgs {
  command:
    | 'help'
    | 'version'
    | 'ask'
    | 'run'
    | 'index'
    | 'status'
    | 'export-session'
    | 'session'
    | 'setup'
    | 'connect'
    | 'schedule'
    | 'serve'
    | 'events'
    | 'unknown'
    | 'error';
  prompt?: string;
  cwd?: string;
  json?: boolean;
  forceEcho?: boolean;
  autoClarify?: string;
  autoApproval?: 'approved' | 'denied';
  /** Unattended CI: `mitii run --auto`. */
  auto?: boolean;
  exportPath?: string;
  mode?: AgentMode;
  origin?: UserRequestOrigin;
  autonomyPreset?: MitiiAutonomyPreset;
  /** Path or id for `.mitii/agents/<id>.md`. */
  agent?: string;
  /** Explicitly attach skill ids for this run (repeatable). */
  skills?: string[];
  /** Prompt file path, or `-` for stdin. */
  promptFile?: string;
  unknownCommand?: string;
  errorMessage?: string;
  setupProvider?: string;
  setupModel?: string;
  setupBaseUrl?: string;
  setupGlobal?: boolean;
  setupShow?: boolean;
  setupTest?: boolean;
  setupYes?: boolean;
  /** One-off loop-policy threshold JSON (lab). Implies overrides for this run. */
  loopPolicyJson?: string;
  /** Force window-band standards even if config enables loopPolicy. */
  noLoopPolicy?: boolean;
  /** Passthrough args after `connect` (channel + channel flags). */
  rest: string[];
}

function takeValue(
  args: string[],
  index: number,
  flag: string,
): { value: string; next: number } | { error: string } {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    return { error: `mitii: ${flag} requires a value` };
  }
  return { value, next: index + 1 };
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = argv.slice(2);
  const flags = new Set<string>();
  const positionals: string[] = [];
  let cwd: string | undefined;
  let autoClarify: string | undefined;
  let autoApproval: 'approved' | 'denied' | undefined;
  let exportPath: string | undefined;
  let mode: AgentMode | undefined;
  let origin: UserRequestOrigin | undefined;
  let autonomyPreset: MitiiAutonomyPreset | undefined;
  let agent: string | undefined;
  let promptFile: string | undefined;
  const skills: string[] = [];
  let setupProvider: string | undefined;
  let setupModel: string | undefined;
  let setupBaseUrl: string | undefined;
  let loopPolicyJson: string | undefined;
  /** Once `connect` is seen, remaining argv (flags included) is channel passthrough. */
  let connectPassthrough: string[] | undefined;
  /** Once `schedule`/`serve` is seen, remaining argv (flags included) is subcommand passthrough. */
  let automationPassthrough: string[] | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (connectPassthrough) {
      connectPassthrough.push(arg);
      continue;
    }
    if (automationPassthrough) {
      automationPassthrough.push(arg);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { command: 'help', rest: [] };
    }
    if (arg === '--version' || arg === '-v') {
      return { command: 'version', rest: [] };
    }
    if (arg === '--cwd') {
      const taken = takeValue(args, i, '--cwd');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      cwd = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--json') {
      flags.add('json');
      continue;
    }
    if (arg === '--echo') {
      flags.add('echo');
      continue;
    }
    if (arg === '--clarify') {
      const taken = takeValue(args, i, '--clarify');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      autoClarify = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--approve') {
      autoApproval = 'approved';
      continue;
    }
    if (arg === '--auto') {
      flags.add('auto');
      continue;
    }
    if (arg === '--deny') {
      autoApproval = 'denied';
      continue;
    }
    if (arg === '--out') {
      const taken = takeValue(args, i, '--out');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      exportPath = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--mode') {
      const taken = takeValue(args, i, '--mode');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      if (taken.value === 'ask' || taken.value === 'plan' || taken.value === 'agent') {
        mode = taken.value;
      } else {
        return {
          command: 'error',
          errorMessage: `mitii: --mode must be ask, plan, or agent (got "${taken.value}")`,
          rest: [],
        };
      }
      i = taken.next;
      continue;
    }
    if (arg === '--origin') {
      const taken = takeValue(args, i, '--origin');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      if (
        taken.value === 'user' ||
        taken.value === 'automation' ||
        taken.value === 'api'
      ) {
        origin = taken.value;
      } else {
        return {
          command: 'error',
          errorMessage: `mitii: --origin must be user, automation, or api (got "${taken.value}")`,
          rest: [],
        };
      }
      i = taken.next;
      continue;
    }
    if (arg === '--autonomy') {
      const taken = takeValue(args, i, '--autonomy');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      if (
        taken.value === 'readonly' ||
        taken.value === 'propose' ||
        taken.value === 'apply' ||
        taken.value === 'apply_and_pr'
      ) {
        autonomyPreset = taken.value;
      } else {
        return {
          command: 'error',
          errorMessage: `mitii: --autonomy must be readonly, propose, apply, or apply_and_pr (got "${taken.value}")`,
          rest: [],
        };
      }
      i = taken.next;
      continue;
    }
    if (arg === '--skill') {
      const taken = takeValue(args, i, '--skill');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      skills.push(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === '--agent') {
      const taken = takeValue(args, i, '--agent');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      agent = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--prompt-file') {
      const taken = takeValue(args, i, '--prompt-file');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      promptFile = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--loop-policy-json') {
      const taken = takeValue(args, i, '--loop-policy-json');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      loopPolicyJson = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--no-loop-policy') {
      flags.add('no-loop-policy');
      continue;
    }
    if (arg === '--provider') {
      const taken = takeValue(args, i, '--provider');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      setupProvider = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--model') {
      const taken = takeValue(args, i, '--model');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      setupModel = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--base-url') {
      const taken = takeValue(args, i, '--base-url');
      if ('error' in taken) {
        return { command: 'error', errorMessage: taken.error, rest: [] };
      }
      setupBaseUrl = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--global') {
      flags.add('global');
      continue;
    }
    if (arg === '--show') {
      flags.add('show');
      continue;
    }
    if (arg === '--test') {
      flags.add('test');
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      flags.add('yes');
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        command: 'error',
        errorMessage: `mitii: unknown option "${arg}"\nTry "mitii --help" for usage.`,
        rest: [],
      };
    }
    positionals.push(arg);
    if (arg === 'connect' && positionals.length === 1) {
      connectPassthrough = [];
    }
    if (
      (arg === 'schedule' || arg === 'serve' || arg === 'events') &&
      positionals.length === 1
    ) {
      automationPassthrough = [];
    }
  }

  const [command = 'help', ...rest] = positionals;
  if (command === 'help') return { command: 'help', rest: [] };
  if (command === 'version') return { command: 'version', rest: [] };
  if (command === 'setup') {
    return {
      command: 'setup',
      cwd,
      mode,
      setupProvider,
      setupModel,
      setupBaseUrl,
      setupGlobal: flags.has('global'),
      setupShow: flags.has('show'),
      setupTest: flags.has('test'),
      setupYes: flags.has('yes'),
      rest,
    };
  }
  if (command === 'index' || command === 'status' || command === 'session') {
    return {
      command,
      cwd,
      json: flags.has('json'),
      forceEcho: flags.has('echo'),
      mode,
      loopPolicyJson,
      noLoopPolicy: flags.has('no-loop-policy'),
      rest,
    };
  }
  if (command === 'export-session') {
    return {
      command: 'export-session',
      prompt: rest.join(' ').trim() || undefined,
      cwd,
      json: true,
      forceEcho: flags.has('echo'),
      exportPath,
      mode,
      loopPolicyJson,
      noLoopPolicy: flags.has('no-loop-policy'),
      rest,
    };
  }
  if (command === 'ask' || command === 'run') {
    const prompt = rest.join(' ').trim();
    return {
      command,
      prompt: prompt.length > 0 ? prompt : undefined,
      cwd,
      json: flags.has('json'),
      forceEcho: flags.has('echo'),
      autoClarify,
      autoApproval,
      auto: flags.has('auto'),
      mode,
      origin,
      autonomyPreset,
      agent,
      promptFile,
      skills: skills.length > 0 ? skills : undefined,
      loopPolicyJson,
      noLoopPolicy: flags.has('no-loop-policy'),
      rest,
    };
  }
  if (command === 'connect') {
    return {
      command: 'connect',
      cwd,
      forceEcho: flags.has('echo'),
      autoApproval,
      mode,
      rest: connectPassthrough ?? rest,
    };
  }
  if (command === 'schedule' || command === 'serve' || command === 'events') {
    return {
      command,
      cwd,
      json: flags.has('json'),
      forceEcho: flags.has('echo'),
      rest: automationPassthrough ?? rest,
    };
  }

  return {
    command: 'unknown',
    unknownCommand: command,
    rest,
  };
}

