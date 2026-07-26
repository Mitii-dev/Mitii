#!/usr/bin/env node
// Root bin is no longer registered in package.json (Phase 13).
// Prefer: pnpm --filter @mitii/cli start
// or:     node apps/cli/bin/mitii.js
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const result = spawnSync(
  process.execPath,
  [join(__dirname, '../apps/cli/bin/mitii.js'), ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
