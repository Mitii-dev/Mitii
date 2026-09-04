import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { parse as parseYaml } from 'yaml';
import { runHttpCheck } from './http-check.mjs';
import { runProcess } from './process.mjs';
import { diffSnapshots } from './snapshot.mjs';

export async function verifyCheck(check, context) {
  try {
    const result = await verify(check, context);
    return { type: check.type, ...result };
  } catch (error) {
    return { type: check.type, passed: false, details: error.message };
  }
}

async function verify(check, context) {
  const { output, agentExitCode, workspace, before, after } = context;
  if (check.type === 'agent_exit') {
    return result(agentExitCode === check.equals, `exit ${agentExitCode}`);
  }
  if (check.type === 'output_not_empty') {
    return result(output.trim().length > 0, `${output.trim().length} characters`);
  }
  if (check.type === 'output_contains') {
    return result(normalize(output, check.caseSensitive).includes(normalize(check.value, check.caseSensitive)));
  }
  if (check.type === 'output_contains_any') {
    const passed = check.values.some((value) =>
      normalize(output, check.caseSensitive).includes(normalize(value, check.caseSensitive))
    );
    return result(passed, `accepted any of: ${check.values.join(', ')}`);
  }
  if (check.type === 'output_not_contains') {
    const inspected = check.scope === 'model' ? extractModelText(output) : output;
    return result(!normalize(inspected, check.caseSensitive).includes(normalize(check.value, check.caseSensitive)));
  }
  if (check.type === 'output_regex') {
    return result(new RegExp(check.pattern, check.flags ?? 'i').test(output));
  }
  if (check.type === 'jsonl_event') {
    const types = check.event === 'end' ? new Set(['end', 'done']) : new Set([check.event]);
    return result(parseJsonLines(output).some((event) => types.has(event?.type)));
  }
  if (check.type === 'json_path_truthy') {
    const passed = parseJsonLines(output).some((event) =>
      Boolean(readPath(event, check.path)) || Boolean(readPath(event?.plan, check.path))
    );
    return result(passed);
  }
  if (check.type === 'file_exists') {
    return result(existsSync(join(workspace, check.path)));
  }
  if (check.type === 'file_not_exists') {
    return result(!existsSync(join(workspace, check.path)));
  }
  if (check.type === 'file_contains' || check.type === 'file_not_contains') {
    const path = join(workspace, check.path);
    const contains = existsSync(path) && readFileSync(path, 'utf8').includes(check.value);
    return result(check.type === 'file_contains' ? contains : !contains);
  }
  if (check.type === 'file_contains_any') {
    const paths = check.paths ?? (check.path ? [check.path] : []);
    const hit = paths.find(
      (relative) =>
        existsSync(join(workspace, relative)) &&
        readFileSync(join(workspace, relative), 'utf8').includes(check.value)
    );
    return result(Boolean(hit), hit ? `matched ${hit}` : `none of: ${paths.join(', ')}`);
  }
  if (check.type === 'dir_has_files') {
    const path = join(workspace, check.path);
    const count = existsSync(path)
      ? readdirSync(path).filter((entry) => statSync(join(path, entry)).isFile()).length
      : 0;
    return result(count >= (check.minimum ?? 1), `${count} files`);
  }
  if (check.type === 'workspace_unchanged') {
    const changed = diffSnapshots(before, after);
    return result(changed.length === 0, changed.join(', '));
  }
  if (check.type === 'workspace_changed') {
    const changed = diffSnapshots(before, after);
    return result(changed.length > 0, changed.join(', '));
  }
  if (check.type === 'file_unchanged' || check.type === 'file_changed') {
    const target = check.path.replaceAll('\\', '/').replace(/\/+$/, '');
    const changed = diffSnapshots(before, after).some(
      (path) => path === target || path.startsWith(`${target}/`)
    );
    return result(check.type === 'file_changed' ? changed : !changed);
  }
  if (check.type === 'command') {
    const execution = await runProcess({
      command: check.command,
      cwd: workspace,
      timeoutMs: check.timeoutMs ?? 120000,
      shell: true,
    });
    const passed =
      execution.exitCode === (check.exitCode ?? 0) &&
      (!check.stdoutContains || execution.stdout.includes(check.stdoutContains));
    return result(passed, `${check.command} -> ${execution.exitCode}\n${(execution.stderr || execution.stdout).slice(0, 500)}`);
  }
  if (check.type === 'http') {
    return runHttpCheck(check, workspace);
  }
  if (check.type === 'skills_installed') {
    const path = join(workspace, '.mitii', 'skills');
    const count = existsSync(path)
      ? readdirSync(path).filter((entry) => existsSync(join(path, entry, 'SKILL.md'))).length
      : 0;
    return result(count >= check.minimum, `${count} skills`);
  }
  if (check.type === 'sqlite_query') {
    return runSqliteQueryCheck(check, workspace);
  }
  if (check.type === 'changed_file_count') {
    const changed = diffSnapshots(before, after);
    const passed =
      changed.length >= (check.minimum ?? 0) && changed.length <= (check.maximum ?? Infinity);
    return result(passed, `${changed.length} files changed: ${changed.join(', ')}`);
  }
  if (check.type === 'workflow_yaml_valid') {
    return runWorkflowYamlCheck(check, workspace);
  }
  return result(false, `Unsupported check type: ${check.type}`);
}

function runSqliteQueryCheck(check, workspace) {
  const dbPath = join(workspace, check.dbPath);
  if (!existsSync(dbPath)) return result(false, `sqlite db not found: ${check.dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(check.sql).all();
    const row = rows[check.row ?? 0];
    const actual = row ? row[check.column] : undefined;
    if (check.equals !== undefined) {
      return result(row !== undefined && String(actual) === String(check.equals), `row ${check.row ?? 0}.${check.column} = ${actual}`);
    }
    if (check.minimum !== undefined) {
      return result(row !== undefined && Number(actual) >= check.minimum, `row ${check.row ?? 0}.${check.column} = ${actual}`);
    }
    return result(rows.length > 0, `${rows.length} rows`);
  } finally {
    db.close();
  }
}

function runWorkflowYamlCheck(check, workspace) {
  const path = join(workspace, check.path);
  if (!existsSync(path)) return result(false, `workflow file not found: ${check.path}`);
  let parsed;
  try {
    parsed = parseYaml(readFileSync(path, 'utf8'));
  } catch (error) {
    return result(false, `invalid YAML: ${error.message}`);
  }
  const jobs = Object.keys(parsed?.jobs ?? {});
  const triggers = normalizeWorkflowTriggers(parsed?.on);
  const missingJobs = (check.requireJobs ?? []).filter((job) => !jobs.includes(job));
  const missingTriggers = (check.requireTriggers ?? []).filter((trigger) => !triggers.includes(trigger));
  const passed = missingJobs.length === 0 && missingTriggers.length === 0;
  const details = [
    `jobs=${jobs.join(',')}`,
    `triggers=${triggers.join(',')}`,
    missingJobs.length ? `missingJobs=${missingJobs.join(',')}` : '',
    missingTriggers.length ? `missingTriggers=${missingTriggers.join(',')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return result(passed, details);
}

function normalizeWorkflowTriggers(on) {
  if (!on) return [];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  if (typeof on === 'object') return Object.keys(on);
  return [];
}

function parseJsonLines(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Plain output is allowed; it simply has no structured event.
    }
  }
  return events;
}

function extractModelText(text) {
  const accepted = new Set(['assistant_delta', 'reasoning_delta', 'done']);
  const parts = parseJsonLines(text)
    .filter((event) => accepted.has(event?.type) && typeof event.content === 'string')
    .map((event) => event.content);
  return parts.length ? parts.join('\n') : text;
}

function readPath(value, path) {
  return String(path).split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function normalize(value, caseSensitive = false) {
  const text = String(value);
  return caseSensitive ? text : text.toLowerCase();
}

function result(passed, details = '') {
  return { passed, details };
}
