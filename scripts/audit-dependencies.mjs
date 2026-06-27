#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ignores = [
  '@babel/*',
  '@vitejs/*',
  '@types/*',
  'electron',
  'electron-builder',
  'eslint*',
  'prettier',
  'typescript',
  'vite',
  'vitest',
  'react',
  'react-dom',
];

const localBin = process.platform === 'win32'
  ? 'node_modules\\.bin\\depcheck.cmd'
  : 'node_modules/.bin/depcheck';

const command = existsSync(localBin) ? localBin : 'npx';
const args = existsSync(localBin)
  ? ['--json', `--ignores=${ignores.join(',')}`]
  : ['--yes', 'depcheck', '--json', `--ignores=${ignores.join(',')}`];

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  shell: false,
  env: { ...process.env, FORCE_COLOR: '0' },
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
