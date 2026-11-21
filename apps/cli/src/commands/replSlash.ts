import type { SessionIo } from '../session.js';

/** What the REPL loop should do after a slash command ran. */
export type SlashAction = 'continue' | 'exit' | 'clear';

interface SlashCommandSpec {
  names: readonly string[];
  summary: string;
  run: (io: SessionIo) => SlashAction;
}

const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  {
    names: ['exit', 'quit'],
    summary: 'Leave the session',
    run: () => 'exit',
  },
  {
    names: ['help'],
    summary: 'Show this list',
    run: (io) => {
      io.writeStdout(formatSlashHelp());
      return 'continue';
    },
  },
  {
    names: ['clear'],
    summary: 'Forget the conversation and task list; start a fresh thread',
    run: (io) => {
      io.writeStderr('[mitii] conversation cleared\n');
      return 'clear';
    },
  },
];

// `/word` optionally followed by whitespace + args. Paths such as `/usr/bin`
// do not match, so they are still sent to the agent as a normal prompt.
const SLASH_PATTERN = /^\/([a-z][a-z0-9_-]*)(?:\s.*)?$/i;

export function formatSlashHelp(): string {
  const rows = SLASH_COMMANDS.map(
    (spec) =>
      `  ${spec.names.map((name) => `/${name}`).join(', ').padEnd(16)} ${spec.summary}`,
  );
  return `Session commands:\n${rows.join('\n')}\n  (empty line is ignored; Ctrl-D also exits)\n`;
}

/**
 * Handle a REPL line as a slash command. Returns `undefined` when the line is
 * not a slash command and should be sent to the agent.
 */
export function runSlashCommand(
  line: string,
  io: SessionIo,
): SlashAction | undefined {
  const match = SLASH_PATTERN.exec(line.trim());
  if (!match) return undefined;
  const name = match[1]!.toLowerCase();
  const spec = SLASH_COMMANDS.find((candidate) =>
    candidate.names.includes(name),
  );
  if (!spec) {
    io.writeStderr(`[mitii] unknown command /${name} — try /help\n`);
    return 'continue';
  }
  return spec.run(io);
}
