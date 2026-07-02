import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const readme = readFileSync('README.md', 'utf8');

const requiredAssets = [
  pkg.icon,
  'media/Mitii.png',
].filter(Boolean);

const missingAssets = requiredAssets.filter((asset) => !existsSync(asset));
if (missingAssets.length > 0) {
  console.error(`Missing release media assets: ${missingAssets.join(', ')}`);
  process.exit(1);
}

const version = String(pkg.version);
if (!readme.includes(`alt="Version ${version}"`) || !readme.includes(`badge/version-${version}-111111`)) {
  console.error(`README version badge is out of sync with package.json (${pkg.version}).`);
  console.error('Run: npm run readme:sync-version');
  process.exit(1);
}

console.log(`Release assets OK: ${requiredAssets.map((asset) => basename(asset)).join(', ')}; README version ${version}`);
