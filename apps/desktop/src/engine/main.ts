/**
 * mitii-desktop-engine entry — runnable without Electron for tests/CI.
 */

import { createDesktopClient } from './createDesktopHost.js';
import { formatEngineHelp, parseEngineArgs } from './parseArgs.js';
import { startEngineServer } from './server.js';

async function main(): Promise<void> {
  const args = parseEngineArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(formatEngineHelp());
    return;
  }

  const { client, mode } = await createDesktopClient({
    cwd: args.cwd,
    forceEcho: args.forceEcho,
  });

  const handle = await startEngineServer({
    client,
    mode,
    workspaceRoot: args.cwd,
    host: args.host,
    port: args.port,
    token: args.token,
  });

  process.stderr.write(
    `[mitii-desktop-engine] ${handle.url} mode=${mode} cwd=${args.cwd}\n`,
  );
  // Machine-readable ready line for the Electron parent.
  process.stdout.write(
    `${JSON.stringify({
      op: 'listening',
      url: handle.url,
      port: handle.port,
      mode,
      workspaceRoot: args.cwd,
      protocol: 'mitii-desktop/v1',
    })}\n`,
  );

  await new Promise<void>((resolve) => {
    const stop = () => {
      void handle.close().finally(resolve);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[mitii-desktop-engine] fatal: ${message}\n`);
  process.exitCode = 1;
});
