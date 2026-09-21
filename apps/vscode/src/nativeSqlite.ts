import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';

type SqliteDatabase = Database.Database;
type SqliteOptions = Database.Options;

export type NativeSqliteDatabase = SqliteDatabase;

const NATIVE_BINDING_FILE = 'better_sqlite3.node';

export function openSqliteDatabase(
  filename: string,
  options: SqliteOptions = {},
): SqliteDatabase {
  const nativeBinding = resolveNativeSqliteBinding();
  try {
    return new Database(filename, {
      ...options,
      ...(nativeBinding ? { nativeBinding } : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Surface Electron ABI / missing binding as an actionable Mitii error so the
    // host does not silently fall back to a fingerprint pin without guidance.
    if (
      /NODE_MODULE_VERSION|was compiled against a different|Cannot find module|better_sqlite3/i.test(
        detail,
      )
    ) {
      throw new Error(
        `Mitii SQLite failed to open (${detail}). For VS Code/Cursor Extension Host run \`pnpm run rebuild:native\` (or \`MITII_EDITOR=cursor pnpm run rebuild:native\`) so ${NATIVE_BINDING_FILE} matches Electron, then reload the window.`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
    throw error;
  }
}

export function resolveNativeSqliteBinding(): string | undefined {
  const override = process.env.MITII_SQLITE_NATIVE_BINDING;
  if (override && existsSync(override)) {
    return override;
  }

  if (!process.versions.electron) {
    return undefined;
  }

  const here = __dirname;
  const candidates = [
    join(here, 'native', NATIVE_BINDING_FILE),
    join(here, '..', 'dist', 'native', NATIVE_BINDING_FILE),
    join(here, '..', 'native', NATIVE_BINDING_FILE),
    // Extension root when compiled to dist/*.js
    join(here, '..', '..', 'dist', 'native', NATIVE_BINDING_FILE),
    join(here, '..', '..', 'native', NATIVE_BINDING_FILE),
    // Walk up from nested dist folders
    ...ancestorNativeCandidates(here),
  ];
  const bundled = candidates.find((candidate) => existsSync(candidate));
  if (bundled) {
    return bundled;
  }

  throw new Error(
    `Mitii SQLite native binding is missing. Checked: ${[...new Set(candidates)].join(', ')}. Run \`pnpm run build:all\` (or \`pnpm run rebuild:native\` / \`MITII_EDITOR=cursor pnpm run rebuild:native\`) so ${NATIVE_BINDING_FILE} is staged into dist/native for the Electron extension host, then reload the window.`,
  );
}

function ancestorNativeCandidates(startDir: string): string[] {
  const out: string[] = [];
  let dir = startDir;
  for (let i = 0; i < 6; i += 1) {
    out.push(join(dir, 'native', NATIVE_BINDING_FILE));
    out.push(join(dir, 'dist', 'native', NATIVE_BINDING_FILE));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}
