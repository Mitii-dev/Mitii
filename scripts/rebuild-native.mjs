#!/usr/bin/env node
/**
 * Rebuild native modules for VS Code / Cursor Electron.
 * A normal install compiles for Node.js; the extension host uses Electron's ABI.
 * Also ensures sharp carries vendored libvips so MiniLM text embeddings do not fail
 * when @xenova/transformers imports its image utility module.
 *
 * Override: MITII_ELECTRON_VERSION=42.2.0 pnpm run rebuild:native
 * Override editor: MITII_EDITOR=cursor pnpm run rebuild:native
 */
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const MODULES = ['better-sqlite3'];
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function ensureSharpVendor() {
  console.log('Ensuring sharp vendored libvips is installed for MiniLM embeddings…');
  const result = spawnSync(
    'pnpm',
    ['rebuild', 'sharp'],
    {
      cwd: packageRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, SHARP_IGNORE_GLOBAL_LIBVIPS: '1' },
    }
  );
  return result.status === 0;
}

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

  const preferred = (process.env.MITII_EDITOR ?? process.env.THUNDER_EDITOR ?? 'vscode').toLowerCase();
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
  console.warn('Could not detect editor — falling back to Electron 42.2.0');
  return '42.2.0';
}

function main() {
  if (!ensureSharpVendor()) {
    console.error('\nRebuild failed for sharp/libvips.');
    process.exit(1);
  }

  const electronVersion = detectElectronVersion();
  console.log(`Rebuilding native modules for Electron ${electronVersion}…`);

  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'electron-rebuild',
      '-f',
      '-v',
      electronVersion,
      '-m',
      '.',
      '-w',
      ...MODULES,
    ],
    { cwd: packageRoot, stdio: 'inherit', shell: true }
  );

  if (result.status !== 0) {
    console.error('\nRebuild failed. Try:');
    console.error('  MITII_ELECTRON_VERSION=42.2.0 pnpm run rebuild:native   # VS Code 1.124+');
    console.error('  MITII_ELECTRON_VERSION=39.8.1 pnpm run rebuild:native   # Cursor');
    process.exit(result.status ?? 1);
  }

  console.log('\nNative rebuild complete. Reload the Extension Development Host (F5).');
  console.log('Note: run "pnpm run rebuild:node" before CLI eval or "pnpm test" if native modules fail under Node.');
}

main();
