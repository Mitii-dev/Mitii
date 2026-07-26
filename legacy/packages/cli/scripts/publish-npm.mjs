import { execFileSync } from 'child_process';

const tag = process.env.NPM_TAG ?? 'latest';
const packages = [
  'packages/cli/optional-packages/mitii-darwin-arm64',
  'packages/cli/optional-packages/mitii-darwin-x64',
  'packages/cli/optional-packages/mitii-linux-x64',
  'packages/cli/optional-packages/mitii-win32-x64',
  'packages/cli',
];

for (const dir of packages) {
  execFileSync('npm', ['publish', '--access', 'public', '--tag', tag], { cwd: dir, stdio: 'inherit' });
}
