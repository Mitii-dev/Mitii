#!/usr/bin/env node
/**
 * Preflight checks for real-runtime eval (CLI uses Node ABI, not Electron).
 */
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const benchmarkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(benchmarkDir, '../..');
const require = createRequire(import.meta.url);

export function checkSqliteLoad() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
}

export function rebuildSqliteForNode(packageDir = packageRoot) {
  console.log('Rebuilding better-sqlite3 for current Node (eval CLI requires Node ABI, not Electron)...');
  const result = spawnSync('node', [join(packageRoot, 'scripts/rebuild-node.mjs')], {
    cwd: packageDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

export function runEvalPreflight(options = {}) {
  const { autoRebuild = true, packageDir = packageRoot } = options;
  let check = checkSqliteLoad();
  if (check.ok) return { ok: true };

  const isAbiMismatch = /NODE_MODULE_VERSION/i.test(check.message ?? '');

  if (autoRebuild && isAbiMismatch) {
    const rebuilt = rebuildSqliteForNode(packageDir);
    if (rebuilt) {
      check = checkSqliteLoad();
      if (check.ok) {
        console.log('better-sqlite3 ready for Node CLI eval.');
        return { ok: true };
      }
    }
  }

  return {
    ok: false,
    message: [
      'Eval preflight failed: better-sqlite3 cannot load for the current Node runtime.',
      check.message ?? '',
      '',
      'The VS Code extension uses Electron (pnpm run rebuild:native).',
      'Headless CLI eval uses system Node (pnpm run rebuild:node).',
      '',
      'Fix:',
      '  pnpm run rebuild:node',
      '  pnpm run compile:cli',
      '',
      'If you need both extension F5 and CLI eval:',
      '  pnpm run rebuild:all',
    ].join('\n'),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = runEvalPreflight({ autoRebuild: !process.argv.includes('--no-rebuild') });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log('Eval preflight OK');
}
