import { existsSync, readFileSync, writeFileSync } from 'fs';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const version = root.version;
const packageFiles = [
  'packages/v8/package.json',
  'packages/sdk/package.json',
  'packages/host/package.json',
  'apps/cli/package.json',
  'apps/vscode/package.json',
];

for (const file of packageFiles) {
  if (!existsSync(file)) {
    console.warn(`skip missing ${file}`);
    continue;
  }
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log(`Mitii product packages synced to ${version}`);
