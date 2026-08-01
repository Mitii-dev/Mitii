#!/usr/bin/env node
/**
 * One-click purge of the Phase 16 legacy vault.
 * Human-gated: requires MITII_PURGE_LEGACY=1 or --yes.
 * Never run from CI without an explicit release decision.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const legacyRoot = join(repoRoot, 'legacy');

const args = new Set(process.argv.slice(2));
const confirmed =
  process.env.MITII_PURGE_LEGACY === '1' || args.has('--yes');

function summarize(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .map((name) => {
      const full = join(dir, name);
      let kind = 'file';
      try {
        kind = statSync(full).isDirectory() ? 'dir' : 'file';
      } catch {
        kind = 'unknown';
      }
      return `  - legacy/${name} (${kind})`;
    });
}

if (!existsSync(legacyRoot)) {
  console.error('legacy/ is already absent — nothing to purge.');
  process.exit(1);
}

const entries = summarize(legacyRoot);
console.log('Will permanently remove the Phase 16 legacy vault:');
console.log(`  ${legacyRoot}`);
if (entries.length > 0) {
  console.log('Top-level contents:');
  for (const line of entries) console.log(line);
} else {
  console.log('  (empty directory)');
}

if (!confirmed) {
  console.error(`
Refusing to purge without confirmation.
Re-run with:

  MITII_PURGE_LEGACY=1 pnpm run legacy:purge

or:

  node scripts/legacy-purge.mjs --yes
`);
  process.exit(1);
}

rmSync(legacyRoot, { recursive: true, force: false });
console.log('Removed legacy/. Product packages were not touched.');
process.exit(0);
