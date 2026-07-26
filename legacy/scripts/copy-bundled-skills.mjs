import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function copyBundledDir(relSource, relDest, label) {
  const source = join(root, relSource);
  const dest = join(root, relDest);
  if (!existsSync(source)) {
    console.error(`Missing bundled ${label} source:`, source);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  // Replace destination so removed skills/rules do not linger in dist.
  rmSync(dest, { recursive: true, force: true });
  cpSync(source, dest, { recursive: true, force: true });
  console.log(`Copied bundled ${label} to`, dest);
}

copyBundledDir('src/features/ce/skills/bundled', 'dist/features/ce/skills/bundled', 'skills');
copyBundledDir('src/features/ce/rules/bundled', 'dist/features/ce/rules/bundled', 'rules');
