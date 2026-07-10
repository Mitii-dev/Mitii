import { existsSync, readFileSync, writeFileSync } from 'fs';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const version = root.version;
const packageFiles = [
  'packages/sdk/package.json',
  'packages/daemon/package.json',
  'packages/board/package.json',
  'packages/channels/package.json',
  'packages/cli/package.json',
  'packages/cli/optional-packages/mitii-darwin-arm64/package.json',
  'packages/cli/optional-packages/mitii-darwin-x64/package.json',
  'packages/cli/optional-packages/mitii-linux-x64/package.json',
  'packages/cli/optional-packages/mitii-win32-x64/package.json',
];

for (const file of packageFiles) {
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log(`Mitii packages synced to ${version}`);
