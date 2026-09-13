/**
 * Cross-platform recursive remove that tolerates Windows file locks
 * (antivirus, Extension Development Host, Explorer, etc.).
 *
 * Uses Node's maxRetries, then renames the path aside so a fresh directory
 * can be created even when an immediate delete fails.
 */
const { existsSync, renameSync, rmSync } = require('node:fs');

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryable(err) {
  return (
    err &&
    (err.code === 'EPERM' ||
      err.code === 'EBUSY' ||
      err.code === 'ENOTEMPTY' ||
      err.code === 'EACCES')
  );
}

function rmRf(target, { warn = console.warn } = {}) {
  if (!existsSync(target)) {
    return;
  }

  const opts = { recursive: true, force: true, maxRetries: 15, retryDelay: 100 };

  try {
    rmSync(target, opts);
    return;
  } catch (err) {
    if (!isRetryable(err)) {
      throw err;
    }
  }

  // Windows (and rare Unix) fallback: move aside so callers can recreate `target`.
  const trash = `${target}.trash-${process.pid}-${Date.now()}`;
  try {
    renameSync(target, trash);
  } catch (renameErr) {
    const detail = renameErr.code || renameErr.message;
    throw new Error(
      `Failed to remove "${target}" (${detail}). Close processes locking files under this path ` +
        `(e.g. VS Code Extension Development Host, antivirus scan) and retry.`,
      { cause: renameErr },
    );
  }

  for (let i = 0; i < 8; i++) {
    try {
      rmSync(trash, opts);
      return;
    } catch (err) {
      if (!isRetryable(err) || i === 7) {
        warn(
          `Warning: left behind "${trash}" after remove failed (${err.code || err.message}); delete it manually when unlocked.`,
        );
        return;
      }
      sleepSync(150 * (i + 1));
    }
  }
}

module.exports = { rmRf };
