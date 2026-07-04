import { cpSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src/core/skills/bundled');
const dest = join(root, 'dist/core/skills/bundled');

if (!existsSync(source)) {
  console.error('Missing bundled skills source:', source);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(source, dest, { recursive: true, force: true });
console.log('Copied bundled skills to', dest);
