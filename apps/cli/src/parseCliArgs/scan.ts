import type {
  AgentMode,
  MitiiAutonomyPreset,
  UserRequestOrigin,
} from '@mitii/sdk';
import { takeValue } from './helpers.js';
import type { CliArgScanOutcome } from './scanTypes.js';

/** Walk argv once, collecting flags/positionals or returning an early result. */
export function scanCliArgs(argv: string[]): CliArgScanOutcome {
  const args = argv.slice(2);
  const flags = new Set<string>();
  const positionals: string[] = [];
  let cwd: string | undefined;
  let autoClarify: string | undefined;
  let autoApproval: 'approved' | 'denied' | undefined;
  let exportPath: string | undefined;
  let mode: AgentMode | 'database' | undefined;
  let origin: UserRequestOrigin | undefined;
  let autonomyPreset: MitiiAutonomyPreset | undefined;
  let agent: string | undefined;
  let profile: string | undefined;
  let promptFlag: string | undefined;
  let promptFile: string | undefined;
  let recipe: string | undefined;
  const skills: string[] = [];
  const images: string[] = [];
  let setupProvider: string | undefined;
  let setupModel: string | undefined;
  let setupBaseUrl: string | undefined;
  let loopPolicyJson: string | undefined;
  let timeoutSeconds: number | undefined;
  /** Once `connect` is seen, remaining argv (flags included) is channel passthrough. */
  let connectPassthrough: string[] | undefined;
  /** Once `schedule`/`serve`/`events`/`restore`/`recipe` is seen, remaining argv is passthrough. */
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
      return { kind: 'early', result: { command: 'help', rest: [] } };
    }
    if (arg === '--version' || arg === '-v') {
      return { kind: 'early', result: { command: 'version', rest: [] } };
    }
    if (arg === '--cwd') {
      const taken = takeValue(args, i, '--cwd');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      cwd = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--json') {
      flags.add('json');
      continue;
    }
    if (arg === '--status') {
      flags.add('status');
      continue;
    }
    if (arg === '--stream-json') {
      flags.add('stream-json');
      continue;
    }
    if (arg === '--echo') {
      flags.add('echo');
      continue;
    }
    if (arg === '--clarify') {
      const taken = takeValue(args, i, '--clarify');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
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
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      exportPath = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--mode') {
      const taken = takeValue(args, i, '--mode');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      if (
        taken.value === 'ask' ||
        taken.value === 'plan' ||
        taken.value === 'agent' ||
        taken.value === 'database'
      ) {
        mode = taken.value;
      } else {
        return { kind: 'early', result: {
          command: 'error',
          errorMessage: `mitii: --mode must be ask, plan, agent, or database (got "${taken.value}")`,
          rest: [],
        } };
      }
      i = taken.next;
      continue;
    }
    if (arg === '--origin') {
      const taken = takeValue(args, i, '--origin');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      if (
        taken.value === 'user' ||
        taken.value === 'automation' ||
        taken.value === 'api'
      ) {
        origin = taken.value;
      } else {
        return { kind: 'early', result: {
          command: 'error',
          errorMessage: `mitii: --origin must be user, automation, or api (got "${taken.value}")`,
          rest: [],
        } };
      }
      i = taken.next;
      continue;
    }
    if (arg === '--autonomy') {
      const taken = takeValue(args, i, '--autonomy');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      if (
        taken.value === 'readonly' ||
        taken.value === 'propose' ||
        taken.value === 'apply' ||
        taken.value === 'apply_and_pr'
      ) {
        autonomyPreset = taken.value;
      } else {
        return { kind: 'early', result: {
          command: 'error',
          errorMessage: `mitii: --autonomy must be readonly, propose, apply, or apply_and_pr (got "${taken.value}")`,
          rest: [],
        } };
      }
      i = taken.next;
      continue;
    }
    if (arg === '--skill') {
      const taken = takeValue(args, i, '--skill');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      skills.push(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === '--recipe') {
      const taken = takeValue(args, i, '--recipe');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      recipe = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--image') {
      const taken = takeValue(args, i, '--image');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      images.push(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === '--agent') {
      const taken = takeValue(args, i, '--agent');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      agent = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--profile') {
      const taken = takeValue(args, i, '--profile');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      profile = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--prompt') {
      const taken = takeValue(args, i, '--prompt');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      promptFlag = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--prompt-file') {
      const taken = takeValue(args, i, '--prompt-file');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      promptFile = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--loop-policy-json') {
      const taken = takeValue(args, i, '--loop-policy-json');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      loopPolicyJson = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--timeout') {
      const taken = takeValue(args, i, '--timeout');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      const seconds = Number(taken.value);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return { kind: 'early', result: {
          command: 'error',
          errorMessage: `mitii: --timeout must be a positive number of seconds (got "${taken.value}")`,
          rest: [],
        } };
      }
      timeoutSeconds = seconds;
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
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      setupProvider = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--model') {
      const taken = takeValue(args, i, '--model');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      setupModel = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--base-url') {
      const taken = takeValue(args, i, '--base-url');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
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
    if (arg === '--preview' || arg === '-p') {
      flags.add('preview');
      continue;
    }
    if (arg === '--from') {
      const taken = takeValue(args, i, '--from');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      (flags as Set<string>).add(`from:${taken.value}`);
      i = taken.next;
      continue;
    }
    if (arg === '--to') {
      const taken = takeValue(args, i, '--to');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      (flags as Set<string>).add(`to:${taken.value}`);
      i = taken.next;
      continue;
    }
    if (arg === '--commit' || arg === '-c') {
      const taken = takeValue(args, i, arg);
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      (flags as Set<string>).add(`commit:${taken.value}`);
      i = taken.next;
      continue;
    }
    if (arg === '--format') {
      const taken = takeValue(args, i, '--format');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      if (taken.value !== 'json' && taken.value !== 'sarif') {
        return { kind: 'early', result: {
          command: 'error',
          errorMessage: `mitii: --format must be json or sarif (got "${taken.value}")`,
          rest: [],
        } };
      }
      (flags as Set<string>).add(`format:${taken.value}`);
      i = taken.next;
      continue;
    }
    if (arg === '--output') {
      const taken = takeValue(args, i, '--output');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      (flags as Set<string>).add(`output:${taken.value}`);
      i = taken.next;
      continue;
    }
    if (arg === '--effort') {
      const taken = takeValue(args, i, '--effort');
      if ('error' in taken) {
        return { kind: 'early', result: { command: 'error', errorMessage: taken.error, rest: [] } };
      }
      if (
        taken.value !== 'low' &&
        taken.value !== 'medium' &&
        taken.value !== 'high'
      ) {
        return { kind: 'early', result: {
          command: 'error',
          errorMessage: `mitii: --effort must be low, medium, or high`,
          rest: [],
        } };
      }
      (flags as Set<string>).add(`effort:${taken.value}`);
      i = taken.next;
      continue;
    }
    if (arg.startsWith('-')) {
      return { kind: 'early', result: {
        command: 'error',
        errorMessage: `mitii: unknown option "${arg}"\nTry "mitii --help" for usage.`,
        rest: [],
      } };
    }
    positionals.push(arg);
    if (arg === 'connect' && positionals.length === 1) {
      connectPassthrough = [];
    }
    if (
      (arg === 'schedule' ||
        arg === 'serve' ||
        arg === 'events' ||
        arg === 'restore' ||
        arg === 'recipe' ||
        arg === 'memory' ||
        arg === 'mcp' ||
        arg === 'history') &&
      positionals.length === 1
    ) {
      automationPassthrough = [];
    }
  }

  return {
    kind: 'scanned',
    state: {
      flags,
      positionals,
      cwd,
      autoClarify,
      autoApproval,
      exportPath,
      mode,
      origin,
      autonomyPreset,
      agent,
      profile,
      promptFile,
      recipe,
      skills,
      images,
      setupProvider,
      setupModel,
      setupBaseUrl,
      loopPolicyJson,
      timeoutSeconds,
      connectPassthrough,
      automationPassthrough,
      promptFlag,
    },
  };
}
