import type { AgentMode } from '@mitii/sdk';
import { loadModeProfiles, setActiveModeProfile } from '@mitii/host';

import { loadMitiiHostConfig } from '../config.js';
import { createTermStyle } from '../termStyle.js';
import type { SessionIo } from '../session.js';
import { runInit } from './init.js';
import { runIndex, runIndexStatus } from './index.js';
import { runPathsCommand } from './paths.js';
import { runProfileCommand } from './profile.js';
import { runStatus } from './status.js';

/** What the REPL loop should do after a slash command ran. */
export type SlashAction = 'continue' | 'exit' | 'clear';

export interface ReplSlashState {
  mode: AgentMode;
  profile?: string;
}

export interface ReplSlashContext {
  cwd: string;
  io: SessionIo;
  state: ReplSlashState;
  forceEcho: boolean;
}

interface SlashCommandSpec {
  names: readonly string[];
  summary: string;
  usage?: string;
  run: (ctx: ReplSlashContext, args: string) => Promise<SlashAction> | SlashAction;
}

const MODES: readonly AgentMode[] = ['ask', 'plan', 'agent'];

function style() {
  return createTermStyle(process.stderr);
}

const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  {
    names: ['exit', 'quit'],
    summary: 'Leave the session',
    run: () => 'exit',
  },
  {
    names: ['help', 'h', '?'],
    summary: 'Show session commands',
    run: (ctx) => {
      ctx.io.writeStdout(formatSlashHelp());
      return 'continue';
    },
  },
  {
    names: ['clear', 'new'],
    summary: 'Start a fresh conversation thread',
    run: (ctx) => {
      ctx.io.writeStderr(`${style().muted('[mitii]')} conversation cleared\n`);
      return 'clear';
    },
  },
  {
    names: ['init'],
    summary: 'Bootstrap .mitii/, gitignore, and index this workspace',
    run: async (ctx): Promise<SlashAction> => {
      await runInit({
        cwd: ctx.cwd,
        yes: true,
        agents: false,
        forceEcho: ctx.forceEcho,
        io: ctx.io,
      });
      return 'continue';
    },
  },
  {
    names: ['mode'],
    summary: 'Show or set mode (ask | plan | agent)',
    usage: '/mode [ask|plan|agent]',
    run: (ctx, args): SlashAction => {
      const next = args.trim().toLowerCase();
      if (!next) {
        ctx.io.writeStdout(
          `mode  ${style().brand(ctx.state.mode)}\n`,
        );
        return 'continue';
      }
      if (!MODES.includes(next as AgentMode)) {
        ctx.io.writeStderr(
          `${style().danger('Unknown mode')} "${next}". Use ask | plan | agent.\n`,
        );
        return 'continue';
      }
      ctx.state.mode = next as AgentMode;
      ctx.io.writeStdout(`mode → ${style().brand(ctx.state.mode)}\n`);
      return 'continue';
    },
  },
  {
    names: ['profile'],
    summary: 'List or activate a mode profile',
    usage: '/profile [list|use <slug>|clear|show]',
    run: async (ctx, args): Promise<SlashAction> => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = parts[0] ?? 'list';
      if (sub === 'use' || sub === 'set') {
        const slug = parts[1];
        if (!slug) {
          ctx.io.writeStderr('Usage: /profile use <slug>\n');
          return 'continue';
        }
        const code = await runProfileCommand({
          cwd: ctx.cwd,
          args: ['use', slug],
          io: ctx.io,
        });
        if (code === 0) ctx.state.profile = slug;
        return 'continue';
      }
      if (sub === 'clear') {
        await runProfileCommand({
          cwd: ctx.cwd,
          args: ['clear'],
          io: ctx.io,
        });
        ctx.state.profile = undefined;
        return 'continue';
      }
      if (sub === 'show') {
        await runProfileCommand({
          cwd: ctx.cwd,
          args: ['show', ...(parts[1] ? [parts[1]] : [])],
          io: ctx.io,
        });
        return 'continue';
      }
      // Bare slug → use; otherwise list.
      if (parts.length === 1 && sub !== 'list' && sub !== 'ls') {
        const loaded = loadModeProfiles(ctx.cwd);
        if (loaded.profiles.some((p) => p.slug === sub)) {
          try {
            setActiveModeProfile(ctx.cwd, sub);
            ctx.state.profile = sub;
            ctx.io.writeStdout(`profile → ${style().brand(sub)}\n`);
          } catch (error) {
            ctx.io.writeStderr(
              `${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
          return 'continue';
        }
      }
      await runProfileCommand({
        cwd: ctx.cwd,
        args: ['list'],
        io: ctx.io,
      });
      return 'continue';
    },
  },
  {
    names: ['index'],
    summary: 'Build or refresh the repository index',
    usage: '/index [--status]',
    run: async (ctx, args): Promise<SlashAction> => {
      if (/\b--status\b|\bstatus\b/i.test(args)) {
        await runIndexStatus({ cwd: ctx.cwd, json: false, io: ctx.io });
        return 'continue';
      }
      await runIndex({
        cwd: ctx.cwd,
        json: false,
        forceEcho: ctx.forceEcho,
        io: ctx.io,
      });
      return 'continue';
    },
  },
  {
    names: ['status'],
    summary: 'Show repository + index status',
    run: async (ctx): Promise<SlashAction> => {
      await runStatus({
        cwd: ctx.cwd,
        json: false,
        forceEcho: ctx.forceEcho,
        io: ctx.io,
      });
      return 'continue';
    },
  },
  {
    names: ['doctor'],
    summary: 'Check config, API keys, index, and log paths',
    run: async (ctx): Promise<SlashAction> => {
      await runPathsCommand({
        cwd: ctx.cwd,
        json: false,
        doctor: true,
        io: ctx.io,
      });
      return 'continue';
    },
  },
  {
    names: ['paths'],
    summary: 'Print Mitii paths for this workspace',
    run: async (ctx): Promise<SlashAction> => {
      await runPathsCommand({
        cwd: ctx.cwd,
        json: false,
        doctor: false,
        io: ctx.io,
      });
      return 'continue';
    },
  },
  {
    names: ['config', 'setup'],
    summary: 'Show provider/model config (secrets never printed)',
    run: (ctx) => {
      const config = loadMitiiHostConfig(ctx.cwd);
      const s = style();
      ctx.io.writeStdout(`${s.bold('Provider configuration')}\n`);
      ctx.io.writeStdout(
        `  ${s.label('provider')} ${config.provider ?? s.muted('(unset)')}\n`,
      );
      ctx.io.writeStdout(
        `  ${s.label('preset')} ${config.providerPreset ?? s.muted('(none)')}\n`,
      );
      ctx.io.writeStdout(
        `  ${s.label('model')} ${config.model ?? s.muted('(default)')}\n`,
      );
      ctx.io.writeStdout(
        `  ${s.label('baseUrl')} ${config.baseUrl ?? s.muted('(default)')}\n`,
      );
      ctx.io.writeStdout(
        `  ${s.label('mode')} ${config.defaultMode ?? 'ask'}\n`,
      );
      ctx.io.writeStdout(
        `\n${s.muted('Change with:')} ${s.brand('mitii setup')}\n`,
      );
      return 'continue';
    },
  },
  {
    names: ['whereami', 'cwd'],
    summary: 'Show workspace, mode, and profile',
    run: (ctx) => {
      const s = style();
      ctx.io.writeStdout(`  ${s.label('cwd')} ${ctx.cwd}\n`);
      ctx.io.writeStdout(`  ${s.label('mode')} ${ctx.state.mode}\n`);
      ctx.io.writeStdout(
        `  ${s.label('profile')} ${ctx.state.profile ?? s.muted('(none)')}\n`,
      );
      return 'continue';
    },
  },
];

// `/word` optionally followed by whitespace + args. Paths such as `/usr/bin`
// do not match, so they are still sent to the agent as a normal prompt.
const SLASH_PATTERN = /^\/([a-z?][a-z0-9_-]*)(?:\s+(.*))?$/i;

export function formatSlashHelp(): string {
  const s = style();
  const rows = SLASH_COMMANDS.map((spec) => {
    const names = spec.names.map((name) => `/${name}`).join(', ');
    const usage = spec.usage ? `  ${s.muted(spec.usage)}` : '';
    return `  ${s.brand(names.padEnd(28))} ${spec.summary}${usage ? `\n${usage}` : ''}`;
  });
  return `${s.bold('Session commands')}\n${s.rule(48)}\n${rows.join('\n')}\n${s.rule(48)}\n  ${s.muted('Empty line is ignored · Ctrl-D exits')}\n`;
}

/**
 * Handle a REPL line as a slash command. Returns `undefined` when the line is
 * not a slash command and should be sent to the agent.
 */
export async function runSlashCommand(
  line: string,
  ctx: ReplSlashContext,
): Promise<SlashAction | undefined> {
  const match = SLASH_PATTERN.exec(line.trim());
  if (!match) return undefined;
  const name = match[1]!.toLowerCase();
  const args = match[2] ?? '';
  const spec = SLASH_COMMANDS.find((candidate) =>
    candidate.names.includes(name),
  );
  if (!spec) {
    ctx.io.writeStderr(
      `${style().danger(`[mitii] unknown command /${name}`)} — try /help\n`,
    );
    return 'continue';
  }
  return spec.run(ctx, args);
}
