import { describe, expect, it } from 'vitest';

import { formatEngineHelp, parseEngineArgs } from '../src/engine/parseArgs.js';

describe('parseEngineArgs', () => {
  it('defaults to loopback ephemeral port', () => {
    const args = parseEngineArgs([], {}, '/tmp/ws');
    expect(args.cwd).toBe('/tmp/ws');
    expect(args.host).toBe('127.0.0.1');
    expect(args.port).toBe(0);
    expect(args.forceEcho).toBe(false);
    expect(args.help).toBe(false);
  });

  it('parses flags and env', () => {
    const args = parseEngineArgs(
      ['--echo', '--cwd', '/repo', '--port', '4123', '--token', 'abc'],
      { MITII_DESKTOP_HOST: '127.0.0.1' },
      '/ignored',
    );
    expect(args.forceEcho).toBe(true);
    expect(args.cwd).toBe('/repo');
    expect(args.port).toBe(4123);
    expect(args.token).toBe('abc');
  });

  it('clamps invalid ports to ephemeral', () => {
    expect(parseEngineArgs(['--port', '99999'], {}, '/x').port).toBe(0);
  });

  it('documents help text with protocol routes', () => {
    const help = formatEngineHelp();
    expect(help).toContain('GET  /health');
    expect(help).toContain('POST /v1/prompt');
  });
});
