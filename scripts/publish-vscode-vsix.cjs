const { readdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = resolve(__dirname, '..');
const vsixDir = join(repoRoot, 'dist-vsix');
const extensionPackage = require(join(repoRoot, 'apps', 'vscode', 'package.json'));
const requiredTargets = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'];

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

if (process.env.MITII_ALLOW_PARTIAL_VSCE_PUBLISH !== '1') {
  const basenames = new Set(files.map((file) => file.split(/[\\/]/).pop()));
  const missingTargets = requiredTargets.filter(
    (target) =>
      !basenames.has(
        `${extensionPackage.name}-${extensionPackage.version}-${target}.vsix`,
      ),
  );
  if (missingTargets.length > 0) {
    console.error(
      'Refusing to publish an incomplete VS Code Marketplace set. Native SQLite indexing requires one VSIX per platform.',
    );
    console.error(`Expected targets: ${requiredTargets.join(', ')}`);
    console.error(`Missing targets: ${missingTargets.join(', ')}`);
    console.error(
      'Build/download all release artifacts into dist-vsix/, then rerun publish. Set MITII_ALLOW_PARTIAL_VSCE_PUBLISH=1 only for an intentional single-target release.',
    );
    process.exit(1);
  }
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
