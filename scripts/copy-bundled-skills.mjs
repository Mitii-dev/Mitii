import { cpSync, existsSync, mkdirSync } from 'fs';
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
  cpSync(source, dest, { recursive: true, force: true });
  console.log(`Copied bundled ${label} to`, dest);
}

copyBundledDir('src/core/skills/bundled', 'dist/core/skills/bundled', 'skills');
copyBundledDir('src/core/rules/bundled', 'dist/core/rules/bundled', 'rules');
