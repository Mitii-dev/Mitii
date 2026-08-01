#!/usr/bin/env node
/**
 * Rebuild native modules for VS Code / Cursor Electron.
 * A normal install compiles for Node.js; the extension host uses Electron's ABI.
 * Rebuilds better-sqlite3 for the Extension Host Electron ABI, stages the
 * binding into apps/vscode/dist/native for F5 / code+text indexes, then restores
 * node_modules to the system Node ABI so Vitest/CLI keep working.
 *
 * Override: MITII_ELECTRON_VERSION=42.6.0 pnpm run rebuild:native
 * Override editor: MITII_EDITOR=cursor pnpm run rebuild:native
 * Skip Node restore: MITII_SKIP_NODE_RESTORE=1 pnpm run rebuild:native
 */
import { createRequire } from 'module';
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const MODULES = ['better-sqlite3'];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { stageNativeSqliteBinding } = require('./stage-native-sqlite.cjs');

function readElectronFromPlist(plistPath) {
  if (!existsSync(plistPath)) return null;
  try {
    return execSync(`plutil -extract CFBundleVersion raw "${plistPath}"`, {
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

function inferPreferredEditor() {
  const explicit = (
    process.env.MITII_EDITOR ??
    process.env.THUNDER_EDITOR ??
    ''
  ).toLowerCase();
  if (explicit === 'cursor' || explicit === 'vscode') {
    return explicit;
  }

  // Prefer the editor that is actually hosting this process (F5 / agent terminals).
  const cursorHints = [
    process.env.CURSOR_AGENT,
    process.env.CURSOR_EXTENSION_HOST_ROLE,
    process.env.CURSOR_WORKSPACE_LABEL,
    process.env.VSCODE_CODE_CACHE_PATH,
    process.env.VSCODE_IPC_HOOK,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (cursorHints.includes('cursor')) {
    return 'cursor';
  }

  return 'vscode';
}

function detectElectronVersion() {
  if (process.env.MITII_ELECTRON_VERSION || process.env.THUNDER_ELECTRON_VERSION) {
    return process.env.MITII_ELECTRON_VERSION || process.env.THUNDER_ELECTRON_VERSION;
  }

  const editors = {
    vscode: {
      plist:
        '/Applications/Visual Studio Code.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist',
    },
    cursor: {
      plist:
        '/Applications/Cursor.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist',
    },
  };

  const preferred = inferPreferredEditor();
  const order =
    preferred === 'cursor' ? ['cursor', 'vscode'] : ['vscode', 'cursor'];

  for (const key of order) {
    const version = readElectronFromPlist(editors[key].plist);
    if (version) {
      console.log(`Detected ${key} Electron ${version}`);
      return version;
    }
  }

  // VS Code 1.124+ / Electron 42 (NODE_MODULE_VERSION 146)
  console.warn('Could not detect editor — falling back to Electron 42.6.0');
  return '42.6.0';
}

async function main() {
  const electronVersion = detectElectronVersion();
  console.log(`Rebuilding native modules for Electron ${electronVersion}…`);

  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'electron-rebuild',
      '--build-from-source',
      '-f',
      '-v',
      electronVersion,
      '-m',
      repoRoot,
      '-w',
      ...MODULES,
    ],
    { cwd: repoRoot, stdio: 'inherit', shell: true }
  );

  if (result.status !== 0) {
    console.error('\nRebuild failed. Try:');
    console.error('  MITII_ELECTRON_VERSION=42.6.0 pnpm run rebuild:native   # VS Code 1.124+');
    console.error('  MITII_EDITOR=cursor pnpm run rebuild:native             # Cursor (auto-detects Electron)');
    console.error('  MITII_ELECTRON_VERSION=40.10.3 pnpm run rebuild:native  # Cursor Electron pin');
    process.exit(result.status ?? 1);
  }

  try {
    stageNativeSqliteBinding({ createDist: true });
  } catch (error) {
    console.error(
      `\nNative rebuild succeeded but staging failed: ${
        error instanceof Error ? error.message : error
      }`,
    );
    process.exit(1);
  }

  if (process.env.MITII_SKIP_NODE_RESTORE === '1') {
    console.log(
      '\nNative rebuild complete (Node restore skipped). Reload the Extension Development Host (F5).',
    );
    console.log(
      'Run `pnpm run rebuild:node` before Vitest/CLI — node_modules still has the Electron ABI.',
    );
    return;
  }

  console.log('\nRestoring better-sqlite3 in node_modules for system Node…');
  const rebuildNodePath = resolve(repoRoot, 'scripts/rebuild-node.mjs');
  const { rebuildForNode } = await import(pathToFileURL(rebuildNodePath).href);
  if (!rebuildForNode()) {
    console.error(
      '\nElectron staging succeeded, but restoring the Node ABI failed.',
    );
    console.error('Run `pnpm run rebuild:node` before Vitest/CLI.');
    process.exit(1);
  }

  console.log(
    '\nNative rebuild complete. Electron binding staged; node_modules restored for Node.',
  );
  console.log('Reload the Extension Development Host (F5). Vitest/CLI can run without another rebuild.');
}

await main();
