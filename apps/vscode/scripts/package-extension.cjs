const { copyFileSync, existsSync, mkdirSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');

const extensionRoot = join(__dirname, '..');
const repoRoot = resolve(extensionRoot, '../..');
const pkg = require(join(extensionRoot, 'package.json'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? extensionRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function inferTarget() {
  if (process.env.MITII_VSCODE_TARGET) {
    return process.env.MITII_VSCODE_TARGET;
  }
  return localTarget();
}

function localTarget() {
  const platform =
    process.platform === 'win32'
      ? 'win32'
      : process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'linux'
          ? 'linux'
          : process.platform;
  return `${platform}-${process.arch}`;
}

function assertNativeTargetIsLocal(target) {
  const local = localTarget();
  if (target === local || process.env.MITII_ALLOW_CROSS_TARGET === '1') {
    return;
  }
  throw new Error(
    `Cannot safely package native VSIX target "${target}" on local runtime "${local}". Build native VSIXs on matching runners, or set MITII_ALLOW_CROSS_TARGET=1 only when dist/native was staged externally.`,
  );
}

function stageReleaseFile(source, targetName) {
  const target = join(extensionRoot, targetName);
  copyFileSync(source, target);
  return target;
}

const target = inferTarget();
assertNativeTargetIsLocal(target);

const stagedReleaseFiles = [
  stageReleaseFile(join(repoRoot, 'LICENSE'), 'LICENSE.txt'),
  stageReleaseFile(join(repoRoot, 'CHANGELOG.md'), 'CHANGELOG.md'),
];

try {
  run('pnpm', ['run', 'rebuild:native'], { cwd: repoRoot });
  run('pnpm', ['run', 'build:prod']);
  run('pnpm', ['run', 'audit:package']);

  const outDir = join(repoRoot, 'dist-vsix');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${pkg.name}-${pkg.version}-${target}.vsix`);
  if (existsSync(outFile)) {
    rmSync(outFile, { force: true });
  }

  run('pnpm', [
    'exec',
    'vsce',
    'package',
    '--no-dependencies',
    '--target',
    target,
    '--ignore-other-target-folders',
    '--out',
    outFile,
  ]);

  console.log(`VSIX ready: ${outFile}`);
} finally {
  for (const file of stagedReleaseFiles) {
    rmSync(file, { force: true });
  }
}
