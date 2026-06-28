import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

if (!existsSync('.git')) {
  process.exit(0);
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
if (result.status) process.exit(result.status);
