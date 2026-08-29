const { spawnSync } = require('node:child_process');

const packages = ['@mitii/v8', '@mitii/sdk', '@mitii/host', '@mitii/cli'];
const hasToken = Boolean(process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN);
const hasGithubOidc = Boolean(
  process.env.GITHUB_ACTIONS &&
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL &&
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
);

if (!hasGithubOidc && !hasToken) {
  console.error(
    'Missing npm auth. Configure GitHub OIDC trusted publishing or set NODE_AUTH_TOKEN (or NPM_TOKEN).',
  );
  process.exit(1);
}

if (!process.env.NODE_AUTH_TOKEN && process.env.NPM_TOKEN) {
  process.env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
}

function publishWithPnpm(name, args, env = process.env) {
  return spawnSync('pnpm', ['--filter', name, 'publish', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
}

for (const name of packages) {
  console.log(`Publishing ${name}…`);
  let result;
  if (hasGithubOidc) {
    const trustedEnv = { ...process.env };
    delete trustedEnv.NODE_AUTH_TOKEN;
    delete trustedEnv.NPM_TOKEN;
    result = publishWithPnpm(
      name,
      ['--access', 'public', '--no-git-checks', '--provenance'],
      trustedEnv,
    );
    if ((result.status ?? 1) !== 0 && hasToken) {
      console.warn(
        `Trusted publishing failed for ${name}; retrying with npm token authentication.`,
      );
      result = publishWithPnpm(name, ['--access', 'public', '--no-git-checks']);
    }
  } else {
    result = publishWithPnpm(name, ['--access', 'public', '--no-git-checks']);
  }
  if ((result.status ?? 1) !== 0) {
    console.error(`Failed to publish ${name}`);
    if (hasToken) {
      console.error(
        'If npm reported EOTP in CI, replace NPM_TOKEN with a granular token that has bypass 2FA enabled, or configure npm trusted publishing for this workflow.',
      );
    }
    process.exit(result.status ?? 1);
  }
}

console.log(`Published: ${packages.join(', ')}`);
