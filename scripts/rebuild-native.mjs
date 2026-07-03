#!/usr/bin/env node
/**
 * Rebuild native modules (better-sqlite3) for VS Code / Cursor Electron.
 * A normal install compiles for Node.js; the extension host uses Electron's ABI.
 *
 * Override: THUNDER_ELECTRON_VERSION=42.2.0 pnpm run rebuild:native
 * Override editor: THUNDER_EDITOR=cursor pnpm run rebuild:native
 */
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';

const MODULES = ['better-sqlite3'];

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
  if (process.env.THUNDER_ELECTRON_VERSION) {
    return process.env.THUNDER_ELECTRON_VERSION;
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

  const preferred = (process.env.THUNDER_EDITOR ?? 'vscode').toLowerCase();
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
    { stdio: 'inherit', shell: true }
  );

  if (result.status !== 0) {
    console.error('\nRebuild failed. Try:');
    console.error('  THUNDER_ELECTRON_VERSION=42.2.0 pnpm run rebuild:native   # VS Code 1.124+');
    console.error('  THUNDER_ELECTRON_VERSION=39.8.1 pnpm run rebuild:native   # Cursor');
    process.exit(result.status ?? 1);
  }

  console.log('\nNative rebuild complete. Reload the Extension Development Host (F5).');
  console.log('Note: run "pnpm run rebuild:node" before "pnpm test" if tests fail on sqlite.');
}

main();
