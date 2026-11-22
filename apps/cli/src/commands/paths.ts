import { existsSync } from 'node:fs';

import { readIndexPipelineHealth } from '@mitii/host';
import { loadMitiiHostConfig } from '../config.js';
import { formatMitiiCliPaths, resolveMitiiCliPaths } from '../cliPaths.js';
import { resolveCliPorts } from '../ports.js';
import type { SessionIo } from '../session.js';

export async function runPathsCommand(options: {
  cwd: string;
  json?: boolean;
  doctor?: boolean;
  io: SessionIo;
}): Promise<number> {
  const paths = resolveMitiiCliPaths(options.cwd);
  const config = loadMitiiHostConfig(options.cwd);
  const ports = resolveCliPorts({ cwd: options.cwd, config });

  if (options.json) {
    options.io.writeStdout(
      `${JSON.stringify(
        {
          paths,
          provider: ports.providerLabel,
          defaultMode: ports.defaultMode,
          hasProjectConfig: existsSync(paths.projectConfig),
          hasGlobalConfig: existsSync(paths.globalConfig),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  options.io.writeStdout('Mitii CLI paths\n\n');
  options.io.writeStdout(formatMitiiCliPaths(paths));
  options.io.writeStdout(
    `\nProvider (resolved): ${ports.providerLabel}  defaultMode=${ports.defaultMode}\n`,
  );

  if (options.doctor) {
    options.io.writeStdout('\nDoctor checks\n');
    const checks: Array<{ ok: boolean; msg: string }> = [];
    checks.push({
      ok: Boolean(paths.activeConfig),
      msg: paths.activeConfig
        ? `config present (${paths.activeConfig})`
        : 'no config — run: mitii setup',
    });
    const keyHint =
      process.env.MITII_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;
    checks.push({
      ok: ports.providerLabel === 'echo' || Boolean(keyHint),
      msg:
        ports.providerLabel === 'echo'
          ? 'provider=echo (smoke only) — set MITII_PROVIDER + API key for real runs'
          : keyHint
            ? 'API key env detected'
            : 'no API key env — export ANTHROPIC_API_KEY / OPENAI_API_KEY / MITII_API_KEY',
    });
    const health = readIndexPipelineHealth({ workspaceRoot: options.cwd });
    const indexOk =
      health.overall === 'ready' || health.overall === 'lexical_only';
    checks.push({
      ok: indexOk || existsSync(paths.indexSqlite),
      msg: existsSync(paths.indexSqlite)
        ? `index artifacts present (overall=${health.overall}) — mitii index --status`
        : 'no index yet — run: mitii index',
    });
    checks.push({
      ok: true,
      msg: `logs → ${paths.logsDir}`,
    });
    try {
      const { readMcpSettingsFromDisk } = await import('@mitii/mcp');
      const mcp = readMcpSettingsFromDisk(options.cwd);
      const mcpPath = `${options.cwd}/.mitii/mcp.json`;
      checks.push({
        ok: true,
        msg: existsSync(mcpPath)
          ? `mcp.json present (enabled=${mcp.enabled}, servers=${mcp.servers.length}) — mitii mcp list`
          : 'no mcp.json — optional; see docs CLI → MCP',
      });
    } catch {
      // optional
    }

    let failed = 0;
    for (const c of checks) {
      options.io.writeStdout(`  ${c.ok ? '✓' : '✗'} ${c.msg}\n`);
      if (!c.ok) failed += 1;
    }
    return failed ? 1 : 0;
  }

  return 0;
}
