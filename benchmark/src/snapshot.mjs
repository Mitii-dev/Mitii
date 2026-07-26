import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function snapshotTree(root, ignoredNames = []) {
  const ignored = new Set(ignoredNames);
  const files = new Map();

  function visit(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory).sort()) {
      if (ignored.has(entry)) continue;
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

export function diffSnapshots(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changed = [];
  for (const path of [...paths].sort()) {
    if (before.get(path) !== after.get(path)) changed.push(path);
  }
  return changed;
}
