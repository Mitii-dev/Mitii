import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const readmePath = 'README.md';
const readme = readFileSync(readmePath, 'utf8');
const version = String(pkg.version);

const next = readme.replace(
  /<img alt="Version [^"]+" src="https:\/\/img\.shields\.io\/badge\/version-[^-"]+-111111">/,
  `<img alt="Version ${version}" src="https://img.shields.io/badge/version-${version}-111111">`
);

if (next === readme) {
  throw new Error('Could not find README version badge to update.');
}

writeFileSync(readmePath, next, 'utf8');
console.log(`README version badge synced to ${version}`);
