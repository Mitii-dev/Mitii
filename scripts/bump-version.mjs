import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';

const ROOT_MAJOR = 2;
const shouldStage = process.argv.includes('--stage');
const packagePath = 'package.json';
const lockPath = 'pnpm-lock.yaml';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function nextVersion(currentVersion, now = new Date()) {
  const month = now.getMonth() + 1;
  const [majorRaw, monthRaw, incrementRaw] = String(currentVersion).split('.');
  const major = Number(majorRaw);
  const versionMonth = Number(monthRaw);
  const increment = Number(incrementRaw);

  if (major === ROOT_MAJOR && versionMonth === month && Number.isInteger(increment)) {
    return `${ROOT_MAJOR}.${month}.${increment + 1}`;
  }

  return `${ROOT_MAJOR}.${month}.0`;
}

const pkg = readJson(packagePath);
const version = nextVersion(pkg.version);
pkg.version = version;
writeJson(packagePath, pkg);

if (shouldStage) {
  const paths = [packagePath, ...(existsSync(lockPath) ? [lockPath] : [])];
  const result = spawnSync('git', ['add', ...paths], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}

console.log(`Thunder version bumped to ${version}`);
