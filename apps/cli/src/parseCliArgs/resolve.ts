import { peelGlobalPassthroughFlags } from './helpers.js';
import type { CliArgScanState } from './scanTypes.js';
import type { ParsedCliArgs } from './types.js';

/** Map scanned argv state to a {@link ParsedCliArgs} result. */
export function resolveCliArgs(state: CliArgScanState): ParsedCliArgs {
  const {
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
    promptFlag,
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
  } = state;

  // Bare `mitii` opens an interactive session; use --help for usage.
  const [command = 'session', ...rest] = positionals;
  if (command === 'help') return { command: 'help', rest: [] };
  if (command === 'version') return { command: 'version', rest: [] };
  if (command === 'init') {
    return {
      command: 'init',
      cwd,
      forceEcho: flags.has('echo'),
      initYes: flags.has('yes'),
      initNoIndex: flags.has('no-index'),
      initNoGitignore: flags.has('no-gitignore'),
      initAgents: flags.has('agents'),
      rest,
    };
  }
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
      ...(command === 'session' && profile ? { profile } : {}),
      loopPolicyJson,
      noLoopPolicy: flags.has('no-loop-policy'),
      ...(command === 'index' && flags.has('status')
        ? { indexStatus: true }
        : {}),
      rest,
    };
  }
  if (command === 'paths' || command === 'doctor') {
    return {
      command,
      cwd,
      json: flags.has('json'),
      rest,
    };
  }
  if (command === 'profile') {
    return {
      command: 'profile',
      cwd,
      json: flags.has('json'),
      rest,
    };
  }
  if (command === 'review') {
    const flagValues = [...flags];
    const from = flagValues.find((f) => f.startsWith('from:'))?.slice(5);
    const to = flagValues.find((f) => f.startsWith('to:'))?.slice(3);
    const commit = flagValues.find((f) => f.startsWith('commit:'))?.slice(7);
    const format = flagValues.find((f) => f.startsWith('format:'))?.slice(7) as
      | 'json'
      | 'sarif'
      | undefined;
    const output = flagValues.find((f) => f.startsWith('output:'))?.slice(7);
    const effort = flagValues.find((f) => f.startsWith('effort:'))?.slice(7) as
      | 'low'
      | 'medium'
      | 'high'
      | undefined;
    return {
      command: 'review',
      cwd,
      json: true,
      reviewPreview: flags.has('preview'),
      reviewFrom: from,
      reviewTo: to,
      reviewCommit: commit,
      reviewFormat: format ?? 'json',
      reviewOutput: output,
      reviewEffort: effort,
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
  if (
    command === 'ask' ||
    command === 'plan' ||
    command === 'agent' ||
    command === 'run'
  ) {
    const fromRest = rest.join(' ').trim();
    const fromFlag = promptFlag?.trim() ?? '';
    const promptParts = [fromRest, fromFlag].filter((part) => part.length > 0);
    const prompt =
      promptParts.length > 0 ? promptParts.join('\n\n') : undefined;
    // Mode verbs: `mitii plan` / `mitii agent` set mode unless --mode overrides.
    const resolvedMode =
      mode ??
      (command === 'plan' || command === 'agent' ? command : undefined);
    return {
      command,
      prompt,
      cwd,
      json: flags.has('json'),
      streamJson: flags.has('stream-json'),
      forceEcho: flags.has('echo'),
      autoClarify,
      autoApproval,
      auto: flags.has('auto'),
      mode: resolvedMode,
      origin,
      autonomyPreset,
      agent,
      profile,
      promptFile,
      recipe,
      skills: skills.length > 0 ? skills : undefined,
      images: images.length > 0 ? images : undefined,
      timeoutSeconds,
      loopPolicyJson,
      noLoopPolicy: flags.has('no-loop-policy'),
      rest,
    };
  }
  if (
    command === 'commit-message' ||
    command === 'pr-summary' ||
    command === 'changelog'
  ) {
    const prompt = rest.join(' ').trim();
    return {
      command,
      prompt: prompt.length > 0 ? prompt : undefined,
      cwd,
      json: flags.has('json'),
      streamJson: flags.has('stream-json'),
      forceEcho: flags.has('echo'),
      autoClarify,
      autoApproval,
      mode: mode ?? 'ask',
      origin,
      autonomyPreset,
      agent,
      promptFile,
      recipe: recipe ?? command,
      skills: skills.length > 0 ? skills : undefined,
      images: images.length > 0 ? images : undefined,
      timeoutSeconds,
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
  if (
    command === 'schedule' ||
    command === 'serve' ||
    command === 'events' ||
    command === 'restore' ||
    command === 'recipe' ||
    command === 'memory' ||
    command === 'mcp' ||
    command === 'history'
  ) {
    const peeled = peelGlobalPassthroughFlags(automationPassthrough ?? rest);
    if (peeled.error) {
      return { command: 'error', errorMessage: peeled.error, rest: [] };
    }
    return {
      command,
      cwd: peeled.cwd ?? cwd,
      json: flags.has('json') || peeled.json,
      forceEcho: flags.has('echo') || peeled.echo,
      rest: peeled.rest,
    };
  }

  return {
    command: 'unknown',
    unknownCommand: command,
    rest,
  };
}
