const { readdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = resolve(__dirname, '..');
const vsixDir = join(repoRoot, 'dist-vsix');
const extensionPackage = require(join(repoRoot, 'apps', 'vscode', 'package.json'));

function listVsixFiles() {
  try {
    return readdirSync(vsixDir)
      .filter((name) => name.endsWith('.vsix'))
      .map((name) => join(vsixDir, name))
      .filter((file) => statSync(file).isFile())
      .sort();
  } catch {
    return [];
  }
}

const files = listVsixFiles();
if (files.length === 0) {
  console.error('No VSIX files found in dist-vsix/. Run pnpm run package first.');
  process.exit(1);
}

const expectedPrefix = `${extensionPackage.name}-${extensionPackage.version}-`;
const stale = files.filter((file) => !file.split(/[\\/]/).pop().startsWith(expectedPrefix));
if (stale.length > 0) {
  console.error(
    `Refusing to publish stale VSIX artifacts. Expected filenames to start with ${expectedPrefix}`,
  );
  for (const file of stale) {
    console.error(`  - ${file}`);
  }
  process.exit(1);
}

const result = spawnSync(
  'pnpm',
  [
    '--filter',
    './apps/vscode',
    'exec',
    'vsce',
    'publish',
    '--packagePath',
    ...files,
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  },
);

process.exit(result.status ?? 1);
