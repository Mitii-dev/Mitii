import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function snapshotTree(root, ignoredNames = []) {
  const ignored = new Set(ignoredNames);
  const files = new Map();

  function visit(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory).sort()) {
      if (isIgnoredEntry(entry, ignored)) continue;
      const absolute = join(directory, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute);
      } else if (stat.isFile()) {
        const rel = relative(root, absolute).replaceAll('\\', '/');
        files.set(rel, createHash('sha256').update(readFileSync(absolute)).digest('hex'));
      }
    }
  }

  visit(root);
  return files;
}

/** Exact names plus simple suffix globs like *.tsbuildinfo. */
export function isIgnoredEntry(entry, ignored) {
  if (ignored.has(entry)) return true;
  for (const pattern of ignored) {
    if (typeof pattern !== 'string' || !pattern.startsWith('*.')) continue;
    const suffix = pattern.slice(1); // ".tsbuildinfo"
    if (entry.endsWith(suffix)) return true;
  }
  return false;
}

export function diffSnapshots(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changed = [];
  for (const path of [...paths].sort()) {
    if (before.get(path) !== after.get(path)) changed.push(path);
  }
  return changed;
}
