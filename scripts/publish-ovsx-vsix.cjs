const { readdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = resolve(__dirname, '..');
const vsixDir = join(repoRoot, 'dist-vsix');
const token = process.env.OVSX_PAT || process.env.OVSX_TOKEN;

if (!token) {
  console.log('OVSX_PAT unset — skipping Open VSX publish.');
  process.exit(0);
}

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

for (const file of files) {
  console.log(`Publishing ${file} to Open VSX…`);
  const result = spawnSync(
    'pnpm',
    ['dlx', 'ovsx', 'publish', file, '--pat', token],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    },
  );
  if ((result.status ?? 1) !== 0) {
    console.error(`Failed to publish ${file} to Open VSX`);
    process.exit(result.status ?? 1);
  }
}

console.log(`Published ${files.length} VSIX(es) to Open VSX`);
