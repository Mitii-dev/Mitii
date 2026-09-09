import { existsSync, readFileSync, writeFileSync } from 'fs';

const checkOnly = process.argv.includes('--check');
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const version = root.version;
/** Keep in sync with CI/release/npm-publish workflows and scripts/publish-npm.cjs. */
const packageFiles = [
  'packages/v8/package.json',
  'packages/sdk/package.json',
  'packages/automation/package.json',
  'packages/host/package.json',
  'apps/cli/package.json',
  'apps/daemon/package.json',
  'apps/vscode/package.json',
];

const mismatches = [];

for (const file of packageFiles) {
  if (!existsSync(file)) {
    console.warn(`skip missing ${file}`);
    continue;
  }
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.version !== version) {
    mismatches.push({ file, name: pkg.name ?? file, version: pkg.version });
  }
  if (!checkOnly) {
    pkg.version = version;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

if (checkOnly) {
  if (mismatches.length > 0) {
    console.error(
      `Product package versions drift from root package.json (${version}):`,
    );
    for (const entry of mismatches) {
      console.error(`  - ${entry.file} (${entry.name}): ${entry.version}`);
    }
    console.error('Run: pnpm run sync:versions');
    console.error(
      'Or bump with: pnpm run version:patch|version:minor|version:major',
    );
    process.exit(1);
  }
  console.log(
    `Mitii product packages aligned at ${version} (${packageFiles.length} packages)`,
  );
  process.exit(0);
}

console.log(
  `Mitii product packages synced to ${version} (${packageFiles.length} packages)`,
);
