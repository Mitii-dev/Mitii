import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export async function runHttpCheck(check, cwd) {
  const port = await getFreePort();
  const command = check.start.command.replaceAll('{port}', String(port));
  const child = spawn(command, {
    cwd,
    env: { ...process.env, PORT: String(port), ...(check.start.env ?? {}) },
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const response = await requestWithRetry(baseUrl, check.request, check.timeoutMs ?? 15000);
    const bodyText = await response.text();
    let json;
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = undefined;
    }

    const failures = [];
    if (response.status !== check.expect.status) {
      failures.push(`expected status ${check.expect.status}, got ${response.status}`);
    }
    if (check.expect.bodyContains && !bodyText.includes(check.expect.bodyContains)) {
      failures.push(`body did not contain ${JSON.stringify(check.expect.bodyContains)}`);
    }
    if (check.expect.jsonType && jsonType(json) !== check.expect.jsonType) {
      failures.push(`expected JSON type ${check.expect.jsonType}, got ${jsonType(json)}`);
    }
    if (check.expect.jsonSubset && !isSubset(check.expect.jsonSubset, json)) {
      failures.push(`JSON body did not contain expected subset`);
    }
    for (const path of check.expect.jsonPaths ?? []) {
      if (readPath(json, path) === undefined) failures.push(`missing JSON path ${path}`);
    }

    return {
      passed: failures.length === 0,
      details: failures.length ? failures.join('; ') : `${check.request.method ?? 'GET'} ${check.request.path} -> ${response.status}`,
    };
  } catch (error) {
    return { passed: false, details: `${error.message}; server output: ${logs.slice(0, 500)}` };
  } finally {
    terminateTree(child, 'SIGTERM');
    setTimeout(() => terminateTree(child, 'SIGKILL'), 1000).unref();
  }
}

function terminateTree(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process may already have exited.
  }
}

async function requestWithRetry(baseUrl, request, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const headers = { ...(request.headers ?? {}) };
      let body;
      if (request.json !== undefined) {
        headers['content-type'] ??= 'application/json';
        body = JSON.stringify(request.json);
      }
      return await fetch(`${baseUrl}${request.path}`, {
        method: request.method ?? 'GET',
        headers,
        body,
        signal: AbortSignal.timeout(Math.min(3000, Math.max(1, deadline - Date.now()))),
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`server did not become ready: ${lastError?.message ?? 'timeout'}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error('Could not allocate port'))));
    });
  });
}

function isSubset(expected, actual) {
  if (expected === actual) return true;
  if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((value, index) => isSubset(value, actual[index]));
  }
  return Object.entries(expected).every(([key, value]) => isSubset(value, actual[key]));
}

function readPath(value, path) {
  return path.split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function jsonType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}
