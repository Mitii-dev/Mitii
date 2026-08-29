#!/usr/bin/env node
/**
 * Deterministic filesystem grader for Mitii frontend agent cases.
 *
 * Preferred:
 *   node __bench__/grade.mjs --json '[{"op":"exists","path":"app/about/page.tsx"}]'
 *
 * Also supports flag form:
 *   node __bench__/grade.mjs --exists path --contains path::needle
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const failures = [];

function fail(message) {
  failures.push(message);
}

/** Unwrap matching outer quote pairs only (keeps lang="en" intact). */
function unwrapPairedQuotes(value) {
  let s = String(value ?? '');
  while (
    s.length >= 2 &&
    ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))
  ) {
    s = s.slice(1, -1);
  }
  return s;
}

/** Paths never contain quotes — also drop stray leading/trailing quotes. */
function cleanPath(value) {
  return unwrapPairedQuotes(value)
    .trim()
    .replace(/^['"]+/, '')
    .replace(/['"]+$/, '');
}

/** Needles may include quotes; only unwrap accidental paired wrappers. */
function cleanValue(value) {
  if (value == null) return value;
  return unwrapPairedQuotes(value);
}

function read(relPath) {
  const abs = resolve(root, relPath);
  if (!existsSync(abs)) {
    fail(`missing file: ${relPath}`);
    return null;
  }
  return readFileSync(abs, 'utf8');
}

function runAssertion(assertion) {
  const op = assertion.op;
  const path = cleanPath(assertion.path);
  const value =
    assertion.value == null ? assertion.value : cleanValue(assertion.value);
  if (op === 'exists') {
    if (!existsSync(resolve(root, path))) fail(`exists failed: ${path}`);
    return;
  }
  if (op === 'notExists') {
    if (existsSync(resolve(root, path))) fail(`notExists failed: ${path}`);
    return;
  }
  const text = read(path);
  if (text == null) return;
  if (op === 'contains') {
    if (!valueMatches(text, value, 'includes')) {
      fail(`contains failed: ${path} missing ${JSON.stringify(value)}`);
    }
    return;
  }
  if (op === 'notContains') {
    if (valueMatches(text, value, 'includes')) {
      fail(`notContains failed: ${path} still has ${JSON.stringify(value)}`);
    }
    return;
  }
  if (op === 'matches') {
    const candidates = valueCandidates(value);
    let matched = false;
    for (const candidate of candidates) {
      let regex;
      try {
        regex = new RegExp(candidate, 'm');
      } catch (error) {
        fail(`invalid regex for ${path}: ${error.message}`);
        return;
      }
      if (regex.test(text)) {
        matched = true;
        break;
      }
    }
    if (!matched) fail(`matches failed: ${path} !~ /${value}/`);
    return;
  }
  fail(`unknown op: ${op}`);
}

/** Also try closing a truncated attr="… needle from older case generators. */
function valueCandidates(value) {
  const primary = cleanValue(value);
  const out = [primary];
  if (/=\s*"[^"]+$/.test(primary)) out.push(`${primary}"`);
  if (/=\s*'[^']+$/.test(primary)) out.push(`${primary}'`);
  return [...new Set(out)];
}

function valueMatches(text, value, mode) {
  for (const candidate of valueCandidates(value)) {
    if (mode === 'includes' && text.includes(candidate)) return true;
  }
  return false;
}

function takeFlag(name) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) {
      const value = args[i + 1];
      if (!value) fail(`${name} requires a value`);
      else values.push(value);
      i += 1;
    }
  }
  return values;
}

function splitSpec(spec) {
  const index = spec.indexOf('::');
  if (index === -1) {
    fail(`expected path::value, got ${spec}`);
    return null;
  }
  return {
    path: cleanPath(spec.slice(0, index)),
    value: cleanValue(spec.slice(index + 2)),
  };
}

const jsonIdx = args.indexOf('--json');
if (jsonIdx !== -1) {
  const raw = args[jsonIdx + 1];
  let assertions;
  try {
    assertions = JSON.parse(raw);
  } catch (error) {
    fail(`invalid --json: ${error.message}`);
    assertions = [];
  }
  if (!Array.isArray(assertions)) fail('--json must be an array');
  else for (const assertion of assertions) runAssertion(assertion);
} else {
  for (const path of takeFlag('--exists')) runAssertion({ op: 'exists', path });
  for (const path of takeFlag('--not-exists')) runAssertion({ op: 'notExists', path });
  for (const spec of takeFlag('--contains')) {
    const parsed = splitSpec(spec);
    if (parsed) runAssertion({ op: 'contains', ...parsed });
  }
  for (const spec of takeFlag('--not-contains')) {
    const parsed = splitSpec(spec);
    if (parsed) runAssertion({ op: 'notContains', ...parsed });
  }
  for (const spec of takeFlag('--matches')) {
    const parsed = splitSpec(spec);
    if (parsed) runAssertion({ op: 'matches', ...parsed });
  }
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log('grade ok');
process.exit(0);

