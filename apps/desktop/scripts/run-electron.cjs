/**
 * Launch Electron with ELECTRON_RUN_AS_NODE cleared.
 * Unix `env -u` is not available on Windows cmd/PowerShell.
 */
const { spawn } = require('node:child_process');
const electron = require('electron');

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
function createElectronEnv(env = process.env) {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  return next;
}

/**
 * @param {string[]} [argv]
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
function runElectron(argv = process.argv.slice(2), options = {}) {
  const child = spawn(String(electron), argv, {
    stdio: 'inherit',
    env: createElectronEnv(options.env ?? process.env),
  });

  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  return child;
}

if (require.main === module) {
  runElectron();
}

module.exports = { createElectronEnv, runElectron };
