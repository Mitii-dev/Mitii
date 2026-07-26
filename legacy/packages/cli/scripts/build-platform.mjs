import { mkdirSync, copyFileSync, chmodSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const target = process.env.MITII_PLATFORM_TARGET ?? `${process.platform}-${process.arch}`;
const outDir = join(repoRoot, 'dist-native', target);
mkdirSync(outDir, { recursive: true });

execFileSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit' });
copyFileSync(join(repoRoot, 'bin/mitii.js'), join(outDir, process.platform === 'win32' ? 'mitii.cmd' : 'mitii'));
chmodSync(join(outDir, process.platform === 'win32' ? 'mitii.cmd' : 'mitii'), 0o755);
writeFileSync(join(outDir, 'SHA256SUMS'), '# populated by release workflow after archive creation\n');
console.log(`Prepared Mitii platform bundle in ${outDir}`);
