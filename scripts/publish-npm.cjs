const { spawnSync } = require('node:child_process');

const packages = ['@mitii/v8', '@mitii/sdk', '@mitii/host', '@mitii/cli'];

if (!process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN) {
  console.error(
    'Missing npm auth token. Set NODE_AUTH_TOKEN (or NPM_TOKEN) before publishing.',
  );
  process.exit(1);
}

if (!process.env.NODE_AUTH_TOKEN && process.env.NPM_TOKEN) {
  process.env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
}

for (const name of packages) {
  console.log(`Publishing ${name}…`);
  const result = spawnSync(
    'pnpm',
    ['--filter', name, 'publish', '--access', 'public', '--no-git-checks'],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    },
  );
  if ((result.status ?? 1) !== 0) {
    console.error(`Failed to publish ${name}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`Published: ${packages.join(', ')}`);
