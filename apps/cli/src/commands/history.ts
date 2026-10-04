import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import { resolveMitiiCliPaths } from '../cliPaths.js';
import type { SessionIo } from '../session.js';

interface LogEntry {
  path: string;
  name: string;
  mtimeMs: number;
  size: number;
}

function listCliLogs(logsDir: string): LogEntry[] {
  if (!existsSync(logsDir)) return [];
  return readdirSync(logsDir)
    .filter((name) => name.startsWith('cli-') && name.endsWith('.jsonl'))
    .map((name) => {
      const path = join(logsDir, name);
      const st = statSync(path);
      return { path, name, mtimeMs: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  const text = readFileSync(path, 'utf8');
  const rows: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip bad lines
    }
  }
  return rows;
}

/**
 * `mitii history list|show [file]|usage [--json]`
 * Inspect CLI session logs under .mitii/logs (or MITII_LOGS_PATH).
 */
export async function runHistoryCommand(options: {
  cwd: string;
  args: string[];
  json?: boolean;
  io: SessionIo;
}): Promise<number> {
  const { cwd, json, io } = options;
  const [sub = 'list', ...rest] = options.args.filter((a) => !a.startsWith('-'));
  const { logsDir } = resolveMitiiCliPaths(cwd);
  const logs = listCliLogs(logsDir);

  if (sub === 'list' || sub === 'ls') {
    if (json) {
      io.writeStdout(
        `${JSON.stringify(
          {
            logsDir,
            count: logs.length,
            logs: logs.map((l) => ({
              name: l.name,
              path: l.path,
              mtime: new Date(l.mtimeMs).toISOString(),
              size: l.size,
            })),
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }
    io.writeStdout(`Logs dir: ${logsDir}\n\n`);
    if (logs.length === 0) {
      io.writeStdout(
        'No CLI session logs yet. Run mitii ask / session (MITII_CLI_LOG=0 disables logging).\n',
      );
      return 0;
    }
    for (const l of logs.slice(0, 50)) {
      io.writeStdout(
        `${new Date(l.mtimeMs).toISOString()}  ${String(l.size).padStart(8)}  ${l.name}\n`,
      );
    }
    if (logs.length > 50) {
      io.writeStdout(`… +${logs.length - 50} more\n`);
    }
    io.writeStdout('\nShow: mitii history show [cli-….jsonl|latest]\n');
    return 0;
  }

  if (sub === 'show') {
    const ref = rest[0] ?? 'latest';
    const entry =
      ref === 'latest' || ref === 'last'
        ? logs[0]
        : logs.find((l) => l.name === ref || l.path === ref || l.name.includes(ref));
    if (!entry) {
      io.writeStderr(
        `mitii history show: log not found "${ref}". Run: mitii history list\n`,
      );
      return 2;
    }
    const rows = readJsonl(entry.path);
    if (json) {
      io.writeStdout(
        `${JSON.stringify({ path: entry.path, events: rows }, null, 2)}\n`,
      );
      return 0;
    }
    io.writeStdout(`# ${entry.path}\n`);
    for (const row of rows) {
      io.writeStdout(`${JSON.stringify(row)}\n`);
    }
    return 0;
  }

  if (sub === 'usage') {
    const ref = rest[0] ?? 'latest';
    const entry =
      ref === 'latest' || ref === 'last'
        ? logs[0]
        : logs.find((l) => l.name === ref || l.path === ref || l.name.includes(ref));
    if (!entry) {
      io.writeStderr(
        'mitii history usage: no logs. Run an ask/session first.\n',
      );
      return 2;
    }
    const rows = readJsonl(entry.path);
    const end = [...rows].reverse().find((r) => r.type === 'session_end');
    const start = rows.find((r) => r.type === 'session_start');
    const usage = (end?.usage ?? null) as Record<string, unknown> | null;
    const payload = {
      path: entry.path,
      provider: start?.provider,
      mode: end?.mode ?? start?.mode,
      exitCode: end?.exitCode,
      usage,
      tip: 'Live runs also print: [mitii] usage models=… inTokens=… outTokens=…',
    };
    if (json) {
      io.writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }
    io.writeStdout(`Log: ${entry.path}\n`);
    if (payload.provider) io.writeStdout(`Provider: ${payload.provider}\n`);
    if (payload.mode) io.writeStdout(`Mode: ${payload.mode}\n`);
    if (payload.exitCode !== undefined) {
      io.writeStdout(`Exit: ${payload.exitCode}\n`);
    }
    if (usage && typeof usage === 'object') {
      const parts = Object.entries(usage)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${v}`);
      io.writeStdout(`Usage: ${parts.join(' ')}\n`);
    } else {
      io.writeStdout(
        'Usage: (not recorded in this log — re-run ask after upgrading CLI, or use --json on ask)\n',
      );
    }
    io.writeStdout(`\n${payload.tip}\n`);
    return 0;
  }

  if (sub === 'path') {
    io.writeStdout(`${logsDir}\n`);
    return 0;
  }

  io.writeStderr(
    'Usage: mitii history list|show [latest|file]|usage [latest|file]|path [--json]\n',
  );
  return 2;
}
