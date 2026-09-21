/**
 * Engine CLI arg parsing (testable; no Electron).
 */

export interface EngineArgs {
  cwd: string;
  host: string;
  port: number;
  forceEcho: boolean;
  token?: string;
  help: boolean;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 0; // ephemeral

export function parseEngineArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  defaultCwd: string = process.cwd(),
): EngineArgs {
  let cwd = env.MITII_DESKTOP_CWD?.trim() || defaultCwd;
  let host = env.MITII_DESKTOP_HOST?.trim() || DEFAULT_HOST;
  let port = env.MITII_DESKTOP_PORT
    ? Number(env.MITII_DESKTOP_PORT)
    : DEFAULT_PORT;
  let forceEcho =
    env.MITII_FORCE_ECHO === '1' || env.MITII_FORCE_ECHO === 'true';
  let token = env.MITII_DESKTOP_TOKEN?.trim() || undefined;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--echo') {
      forceEcho = true;
      continue;
    }
    if (arg === '--cwd') {
      cwd = argv[++i] ?? cwd;
      continue;
    }
    if (arg === '--host') {
      host = argv[++i] ?? host;
      continue;
    }
    if (arg === '--port') {
      port = Number(argv[++i] ?? port);
      continue;
    }
    if (arg === '--token') {
      const next = argv[++i];
      token = next && next.length > 0 ? next : undefined;
      continue;
    }
  }

  if (!Number.isFinite(port) || port < 0 || port > 65_535) {
    port = DEFAULT_PORT;
  }

  return { cwd, host, port, forceEcho, token, help };
}

export function formatEngineHelp(): string {
  return `mitii-desktop-engine — local HTTP host for Mitii Desktop

  --cwd <path>     Workspace root (default: cwd / MITII_DESKTOP_CWD)
  --host <addr>    Bind address (default: 127.0.0.1)
  --port <n>       Port (default: 0 = ephemeral)
  --token <t>      Optional bearer for /v1/* (MITII_DESKTOP_TOKEN)
  --echo           Force EchoLlmPort (smoke)

Protocol: mitii-desktop/v1
  GET  /health
  POST /v1/prompt   NDJSON stream (ready | event | result | error)
`;
}
