#!/usr/bin/env node
/**
 * Ensure better-sqlite3 in node_modules matches the current Node ABI.
 * No-ops when already correct; rebuilds via rebuild-node.mjs when the
 * binding is missing or was compiled for a different Node ABI.
 * Intended as a pretest guard so Vitest/CLI never fail with NODE_MODULE_VERSION errors.
 */
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { rebuildForNode } from './rebuild-node.mjs';

const v8PackageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/v8',
);
const require = createRequire(resolve(v8PackageRoot, 'package.json'));

function isRecoverableNativeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('NODE_MODULE_VERSION') ||
    message.includes('was compiled against a different Node.js version') ||
    message.includes('Could not locate the bindings file') ||
    message.includes('is not a valid Win32 application') ||
    message.includes('invalid ELF header') ||
    message.includes('wrong ELF class') ||
    /dlopen\(.*better.?sqlite3/i.test(message)
  );
}

function tryLoadSqlite() {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.close();
}

function main() {
  try {
    tryLoadSqlite();
    return;
  } catch (error) {
    if (!isRecoverableNativeError(error)) {
      console.error(
        `better-sqlite3 failed to load (not recoverable):\n${
          error instanceof Error ? error.stack ?? error.message : error
        }`,
      );
      process.exit(1);
    }
    console.warn(
      `better-sqlite3 native binding unavailable for Node ${process.version} — rebuilding for system Node…`,
    );
  }

  if (!rebuildForNode()) {
    console.error('Failed to rebuild better-sqlite3 for system Node.');
    process.exit(1);
  }

  try {
    tryLoadSqlite();
    console.log('better-sqlite3 is ready for system Node.');
  } catch (error) {
    console.error(
      `better-sqlite3 still fails after rebuild:\n${
        error instanceof Error ? error.stack ?? error.message : error
      }`,
    );
    process.exit(1);
  }
}

main();
