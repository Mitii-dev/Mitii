#!/usr/bin/env node
/**
 * Validates tools/benchmark/tasks/manual/**\/*.json before they're run.
 * Keeps the "just drop a JSON file in the folder" extension model safe: a malformed
 * new task fails fast here instead of silently no-op'ing in run-manual.mjs.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const benchmarkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manualDir = join(benchmarkDir, 'tasks/manual');
const fixtureDir = join(benchmarkDir, 'fixtures');

const MODES = new Set(['ask', 'plan', 'agent']);
const SEVERITIES = new Set(['easy', 'medium', 'hard']);
const KNOWN_RULE_PREFIXES = [
  'exit_0',
  'stdout_contains:',
  'stdout_not_empty',
  'stdout_not_contains:',
  'json_path:',
  'jsonl_event:',
  'file_exists:',
  'file_contains:',
  'file_not_contains:',
  'dir_has_files:',
  'skills_installed:',
  'command_exit_0:',
  'session_log_has:',
  'tool_registered:',
];

const files = findTaskFiles(manualDir);
if (!files.length) {
  console.error(`No manual task files found under ${manualDir}`);
  process.exit(1);
}

const seenIds = new Map(); // id -> file
const errors = [];
let taskCount = 0;

for (const file of files) {
  const relFile = file.slice(benchmarkDir.length + 1);
  let tasks;
  try {
    tasks = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${relFile}: invalid JSON (${error.message})`);
    continue;
  }
  if (!Array.isArray(tasks)) {
    errors.push(`${relFile}: expected a JSON array of tasks`);
    continue;
  }

  const pathParts = relFile.split('/'); // tasks/manual/<mode>/<severity>/<file>.json
  const folderMode = pathParts[2];
  const folderSeverity = pathParts[3];

  for (const [i, task] of tasks.entries()) {
    taskCount += 1;
    const where = `${relFile}[${i}]`;

    if (!task.id || typeof task.id !== 'string') {
      errors.push(`${where}: missing string "id"`);
      continue;
    }
    if (seenIds.has(task.id)) {
      errors.push(`${where}: duplicate id "${task.id}" (also in ${seenIds.get(task.id)})`);
    }
    seenIds.set(task.id, relFile);

    if (!MODES.has(task.mode)) {
      errors.push(`${where} (${task.id}): mode must be one of ${[...MODES].join('|')}, got "${task.mode}"`);
    } else if (task.mode !== folderMode) {
      errors.push(`${where} (${task.id}): mode "${task.mode}" does not match folder "${folderMode}"`);
    }

    if (!SEVERITIES.has(task.severity)) {
      errors.push(`${where} (${task.id}): severity must be one of ${[...SEVERITIES].join('|')}, got "${task.severity}"`);
    } else if (task.severity !== folderSeverity) {
      errors.push(`${where} (${task.id}): severity "${task.severity}" does not match folder "${folderSeverity}"`);
    }

    if (!task.prompt || typeof task.prompt !== 'string') {
      errors.push(`${where} (${task.id}): missing string "prompt"`);
    }

    if (!task.category || typeof task.category !== 'string') {
      errors.push(`${where} (${task.id}): missing string "category"`);
    }

    if (task.fixture && !existsSync(join(fixtureDir, task.fixture))) {
      errors.push(`${where} (${task.id}): fixture "${task.fixture}" not found under tools/benchmark/fixtures/`);
    }

    if (!Array.isArray(task.verify) || task.verify.length === 0) {
      errors.push(`${where} (${task.id}): "verify" must be a non-empty array`);
    } else {
      for (const rule of task.verify) {
        if (!isKnownRule(rule)) {
          errors.push(`${where} (${task.id}): unrecognized verify rule ${JSON.stringify(rule)}`);
        }
      }
    }
  }
}

console.log(`Checked ${taskCount} manual task(s) across ${files.length} file(s).`);

if (errors.length) {
  console.error(`\n${errors.length} validation error(s):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('All manual tasks are valid.');

function findTaskFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findTaskFiles(full));
    } else if (entry.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

function isKnownRule(rule) {
  if (typeof rule === 'string') {
    return KNOWN_RULE_PREFIXES.some((prefix) =>
      prefix.endsWith(':') ? rule.startsWith(prefix) : rule === prefix || rule.startsWith(`${prefix}`)
    );
  }
  if (rule && typeof rule === 'object') {
    if (Array.isArray(rule.all)) return rule.all.every(isKnownRule);
    if (Array.isArray(rule.any)) return rule.any.every(isKnownRule);
  }
  return false;
}
