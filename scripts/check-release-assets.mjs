import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';

const rootPkg = JSON.parse(readFileSync('package.json', 'utf8'));
const vscodePkg = JSON.parse(readFileSync('apps/vscode/package.json', 'utf8'));
const readme = readFileSync('README.md', 'utf8');

const requiredAssets = [
  vscodePkg.icon ? `apps/vscode/${vscodePkg.icon}` : null,
  'apps/vscode/media/mitii-short-logo.png',
  'apps/vscode/media/mitii-activitybar.svg',
].filter(Boolean);

const missingAssets = requiredAssets.filter((asset) => !existsSync(asset));
if (missingAssets.length > 0) {
  console.error(`Missing release media assets: ${missingAssets.join(', ')}`);
  process.exit(1);
}

const version = String(rootPkg.version);
if (!readme.includes(`alt="Version ${version}"`) || !readme.includes(`badge/version-${version}-111111`)) {
  console.error(`README version badge is out of sync with package.json (${rootPkg.version}).`);
  console.error('Run: pnpm run readme:sync-version');
  process.exit(1);
}

console.log(`Release assets OK: ${requiredAssets.map((asset) => basename(asset)).join(', ')}; README version ${version}`);
