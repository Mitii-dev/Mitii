/**
 * CLI for Electron main → desktop SQLite store (system Node ABI).
 *
 * Usage:
 *   node desktop-store-cli.js <op>
 *   stdin: JSON payload
 *   stdout: JSON result
 *
 * Env: MITII_DESKTOP_STORE_PATH = absolute path to mitii-desktop.sqlite
 */

import { openDesktopStore } from './desktop-store.js';
import { mergeDesktopSettings, type DesktopSettings } from '../shared/settings.js';
import type { DesktopProfilesFile } from './profiles.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const op = process.argv[2]?.trim();
  if (!op) fail('usage: desktop-store-cli <op>');

  const dbPath = process.env.MITII_DESKTOP_STORE_PATH?.trim();
  if (!dbPath) fail('MITII_DESKTOP_STORE_PATH required');

  const store = openDesktopStore(dbPath);
  try {
    const raw = (await readStdin()).trim();
    const input = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

    switch (op) {
      case 'migrate': {
        store.migrateLegacy({
          userDataPath:
            typeof input.userDataPath === 'string' ? input.userDataPath : '',
          workspaceRoot:
            typeof input.workspaceRoot === 'string'
              ? input.workspaceRoot
              : undefined,
          fallbackSettings:
            input.fallbackSettings && typeof input.fallbackSettings === 'object'
              ? mergeDesktopSettings(input.fallbackSettings)
              : undefined,
        });
        process.stdout.write(
          `${JSON.stringify({ ok: true, snapshot: store.snapshot() })}\n`,
        );
        break;
      }
      case 'snapshot': {
        const fallback =
          typeof input.fallbackWorkspace === 'string'
            ? input.fallbackWorkspace
            : '';
        process.stdout.write(`${JSON.stringify(store.snapshot(fallback))}\n`);
        break;
      }
      case 'get-settings': {
        const path =
          typeof input.workspaceRoot === 'string' ? input.workspaceRoot : '';
        const settings = path ? store.getWorkspaceSettings(path) : null;
        process.stdout.write(`${JSON.stringify({ settings })}\n`);
        break;
      }
      case 'set-workspace': {
        const path =
          typeof input.workspaceRoot === 'string' ? input.workspaceRoot : '';
        if (!path.trim()) fail('workspaceRoot required');
        store.setActiveWorkspace(path);
        const existing = store.getWorkspaceSettings(path);
        if (!existing && input.settings && typeof input.settings === 'object') {
          store.setWorkspaceSettings(path, mergeDesktopSettings(input.settings));
        }
        process.stdout.write(
          `${JSON.stringify({ ok: true, snapshot: store.snapshot() })}\n`,
        );
        break;
      }
      case 'save-settings': {
        const path =
          typeof input.workspaceRoot === 'string' ? input.workspaceRoot : '';
        if (!path.trim()) fail('workspaceRoot required');
        if (!input.settings || typeof input.settings !== 'object') {
          fail('settings required');
        }
        store.setActiveWorkspace(path);
        store.setWorkspaceSettings(
          path,
          mergeDesktopSettings(input.settings as DesktopSettings),
        );
        process.stdout.write(
          `${JSON.stringify({ ok: true, snapshot: store.snapshot() })}\n`,
        );
        break;
      }
      case 'set-index-meta': {
        const path =
          typeof input.workspaceRoot === 'string' ? input.workspaceRoot : '';
        if (!path.trim()) fail('workspaceRoot required');
        const fileCount =
          typeof input.fileCount === 'number' ? input.fileCount : 0;
        store.setWorkspaceIndexMeta(path, {
          fileCount,
          updatedAt:
            typeof input.updatedAt === 'string' ? input.updatedAt : undefined,
        });
        process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
        break;
      }
      case 'get-profiles': {
        process.stdout.write(`${JSON.stringify(store.getProfiles())}\n`);
        break;
      }
      case 'set-profiles': {
        if (!input.profiles || typeof input.profiles !== 'object') {
          fail('profiles required');
        }
        store.setProfiles(input.profiles as DesktopProfilesFile);
        process.stdout.write(
          `${JSON.stringify({ ok: true, profiles: store.getProfiles() })}\n`,
        );
        break;
      }
      default:
        fail(`unknown_op:${op}`);
    }
  } finally {
    store.close();
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
