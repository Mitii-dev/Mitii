import { startMitiiDaemon } from './server';

export async function serveCommand(args: string[], cwd: string): Promise<number> {
  const hostname = valueOf(args, '--hostname') ?? '127.0.0.1';
  const port = Number(valueOf(args, '--port') ?? 4310);
  const token = valueOf(args, '--token') ?? process.env.MITII_SERVER_TOKEN;
  const maxSessions = Number(valueOf(args, '--max-sessions') ?? 5);
  const allowOrigin = valueOf(args, '--allow-origin');
  const insecureBind = args.includes('--insecure-bind');
  const server = await startMitiiDaemon({
    cwd: valueOf(args, '--cwd') ?? cwd,
    hostname,
    port: Number.isFinite(port) ? port : 4310,
    token,
    maxSessions: Number.isFinite(maxSessions) ? maxSessions : 5,
    allowOrigin,
    insecureBind,
  });
  process.stderr.write(`Mitii daemon listening on ${server.url}\n`);
  process.stderr.write(`Workspace: ${valueOf(args, '--cwd') ?? cwd}\n`);
  process.stderr.write(token ? 'Auth: bearer token enabled\n' : 'Auth: disabled for loopback\n');

  const shutdown = async () => {
    process.stderr.write('Stopping Mitii daemon...\n');
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await new Promise(() => undefined);
  return 0;
}

function valueOf(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}
