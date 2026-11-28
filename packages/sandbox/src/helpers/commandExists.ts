import { spawnSync } from 'node:child_process';

/** True when `bin` is executable on PATH (exit code ignored). */
export function commandExists(bin: string): boolean {
  const probe = spawnSync(bin, ['--help'], {
    encoding: 'utf8',
    timeout: 2000,
    shell: false,
  });
  return probe.error === undefined;
}
