#!/usr/bin/env node
/**
 * Enforce the Mitii ≤600-line file rule with a shrinking allowlist.
 *
 * Usage:
 *   node scripts/check-file-size.mjs
 *   node scripts/check-file-size.mjs --write-allowlist
 *
 * New files over the limit fail. Allowlisted files may stay over the limit
 * until Wave splits shrink them; dropping below 600 removes them from the
 * allowlist on --write-allowlist.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 600;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowlistPath = join(repoRoot, 'scripts', 'file-size-allowlist.json');

const SCAN_ROOTS = [
  'apps/cli/src',
  'apps/desktop/src',
  'apps/vscode/src',
  'apps/vscode/webview-ui/src',
  'packages/automation/src',
  'packages/host/src',
  'packages/mcp/src',
  'packages/sdk/src',
  'packages/ui-react/src',
  'packages/ui-react/tests',
  'packages/ui-theme/css',
  'packages/ui-theme/src',
  'packages/ui-theme/tests',
  'packages/v8/src',
  'packages/v8/tests',
];

const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.mdc',
]);

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.workspaces',
]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    const ext = entry.name.includes('.')
      ? entry.name.slice(entry.name.lastIndexOf('.'))
      : '';
    if (!EXTENSIONS.has(ext)) continue;
    out.push(full);
  }
  return out;
}

function countLines(path) {
  const text = readFileSync(path, 'utf8');
  if (text.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) n += 1;
  }
  if (text.endsWith('\n')) n -= 1;
  return n;
}

function loadAllowlist() {
  if (!existsSync(allowlistPath)) return new Set();
  const raw = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const files = Array.isArray(raw) ? raw : (raw.files ?? []);
  return new Set(files.map((p) => p.split('/').join(sep)));
}

function toPosix(rel) {
  return rel.split(sep).join('/');
}

const writeAllowlist = process.argv.includes('--write-allowlist');
const offenders = [];

for (const root of SCAN_ROOTS) {
  const absRoot = join(repoRoot, root);
  for (const file of walk(absRoot)) {
    const lines = countLines(file);
    if (lines <= LIMIT) continue;
    offenders.push({
      path: toPosix(relative(repoRoot, file)),
      lines,
    });
  }
}

offenders.sort((a, b) => a.path.localeCompare(b.path));

if (writeAllowlist) {
  const payload = {
    limit: LIMIT,
    note: 'Shrinking allowlist for Mitii ≤600-line rule. Remove entries when files are split under the limit. Do not add new paths except via intentional Wave work tracked in CI.',
    files: offenders.map((o) => o.path),
  };
  writeFileSync(allowlistPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `Wrote ${offenders.length} allowlisted paths to ${toPosix(relative(repoRoot, allowlistPath))}`,
  );
  process.exit(0);
}

const allowlist = loadAllowlist();
const allowlistPosix = new Set([...allowlist].map((p) => toPosix(p)));
const newOffenders = offenders.filter((o) => !allowlistPosix.has(o.path));
const staleAllowlist = [...allowlistPosix].filter(
  (p) => !offenders.some((o) => o.path === p),
);

if (staleAllowlist.length > 0) {
  console.warn(
    `file-size: ${staleAllowlist.length} allowlist entries are now ≤${LIMIT} lines (remove with --write-allowlist):\n` +
      staleAllowlist.map((p) => `  - ${p}`).join('\n'),
  );
}

if (newOffenders.length > 0) {
  console.error(
    `file-size: ${newOffenders.length} file(s) exceed ${LIMIT} lines and are not allowlisted:\n` +
      newOffenders.map((o) => `  ${o.lines}\t${o.path}`).join('\n') +
      `\n\nSplit the file or (only for tracked Wave debt) add it via:\n  node scripts/check-file-size.mjs --write-allowlist`,
  );
  process.exit(1);
}

console.log(
  `file-size: ok (${offenders.length} allowlisted over ${LIMIT}; ${staleAllowlist.length} stale)`,
);
process.exit(0);