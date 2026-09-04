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
    const steps = normalizeHttpSteps(check);
    const timeoutMs = check.timeoutMs ?? 15000;
    const summaries = [];
    const failures = [];

    for (const [index, step] of steps.entries()) {
      const response = await requestWithRetry(baseUrl, step, timeoutMs);
      const bodyText = await response.text();
      let json;
      try {
        json = JSON.parse(bodyText);
      } catch {
        json = undefined;
      }

      const expect = step.expect ?? {};
      const label = `${step.method ?? 'GET'} ${step.path}`;
      summaries.push(`${label} -> ${response.status}`);

      if (expect.status !== undefined && response.status !== expect.status) {
        failures.push(`step ${index + 1} ${label}: expected status ${expect.status}, got ${response.status}`);
      }
      if (expect.bodyContains && !bodyText.includes(expect.bodyContains)) {
        failures.push(`step ${index + 1} ${label}: body did not contain ${JSON.stringify(expect.bodyContains)}`);
      }
      if (expect.jsonType && jsonType(json) !== expect.jsonType) {
        failures.push(`step ${index + 1} ${label}: expected JSON type ${expect.jsonType}, got ${jsonType(json)}`);
      }
      if (expect.jsonSubset && !isSubset(expect.jsonSubset, json)) {
        failures.push(`step ${index + 1} ${label}: JSON body did not contain expected subset`);
      }
      for (const path of expect.jsonPaths ?? []) {
        if (readPath(json, path) === undefined) {
          failures.push(`step ${index + 1} ${label}: missing JSON path ${path}`);
        }
      }
    }

    return {
      passed: failures.length === 0,
      details: failures.length ? failures.join('; ') : summaries.join(' | '),
    };
  } catch (error) {
    return { passed: false, details: `${error.message}; server output: ${logs.slice(0, 500)}` };
  } finally {
    terminateTree(child, 'SIGTERM');
    setTimeout(() => terminateTree(child, 'SIGKILL'), 1000).unref();
  }
}

/** Prefer `requests[]` (each with optional `expect`); fall back to single `request` + top-level `expect`. */
function normalizeHttpSteps(check) {
  if (Array.isArray(check.requests) && check.requests.length > 0) {
    return check.requests.map((step) => ({
      ...step,
      expect: step.expect ?? {},
    }));
  }
  return [
    {
      ...(check.request ?? {}),
      expect: check.expect ?? {},
    },
  ];
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
