#!/usr/bin/env node
import { existsSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';

const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const localMadge = resolve(root, 'node_modules/.bin/madge');
const command = existsSync(localMadge) ? localMadge : 'npx';
const args = existsSync(localMadge)
  ? ['.', '--circular', '--json', '--extensions', 'ts,tsx,js,jsx,mjs,cjs', '--exclude', 'node_modules|dist|out|coverage|\\.git']
  : ['--yes', 'madge', '.', '--circular', '--json', '--extensions', 'ts,tsx,js,jsx,mjs,cjs', '--exclude', 'node_modules|dist|out|coverage|\\.git'];

const result = spawnSync(command, args, {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}

const stdout = result.stdout.trim();
const stderr = result.stderr.trim();

let cycles;
try {
  cycles = stdout ? JSON.parse(stdout) : [];
} catch {
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  process.exit(result.status ?? 1);
}

if (cycles.length === 0) {
  console.log('No circular dependencies found.');
  process.exit(0);
}

console.log(JSON.stringify({ circularDependencies: cycles }, null, 2));
process.exit(1);
