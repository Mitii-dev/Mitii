#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const range = pkg.engines?.node;
const current = process.versions.node;

function normalize(version) {
  const cleaned = String(version).replace(/^v/, '').trim();
  const [major = '0', minor = '0', patch = '0'] = cleaned.split('.');
  return [major, minor, patch].map((part) => Number(part.replace(/\D.*$/, '') || 0));
}

function compare(a, b) {
  const av = normalize(a);
  const bv = normalize(b);
  for (let index = 0; index < 3; index += 1) {
    if (av[index] > bv[index]) return 1;
    if (av[index] < bv[index]) return -1;
  }
  return 0;
}

function satisfiesComparator(version, raw) {
  const comparator = raw.trim();
  if (!comparator || comparator === '*' || comparator.toLowerCase() === 'x') return true;

  const op = comparator.match(/^(>=|<=|>|<|=)?\s*v?([0-9]+(?:\.[0-9x*]+){0,2})$/i);
  if (op) {
    const operator = op[1] ?? '=';
    const wanted = op[2].replace(/[x*]/gi, '0');
    const cmp = compare(version, wanted);
    if (operator === '>=') return cmp >= 0;
    if (operator === '<=') return cmp <= 0;
    if (operator === '>') return cmp > 0;
    if (operator === '<') return cmp < 0;
    return cmp === 0;
  }

  const caret = comparator.match(/^\^\s*v?([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?$/);
  if (caret) {
    const major = Number(caret[1]);
    const lower = `${major}.${caret[2] ?? 0}.${caret[3] ?? 0}`;
    const upper = `${major + 1}.0.0`;
    return compare(version, lower) >= 0 && compare(version, upper) < 0;
  }

  const tilde = comparator.match(/^~\s*v?([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?$/);
  if (tilde) {
    const major = Number(tilde[1]);
    const minor = Number(tilde[2] ?? 0);
    const lower = `${major}.${minor}.${tilde[3] ?? 0}`;
    const upper = `${major}.${minor + 1}.0`;
    return compare(version, lower) >= 0 && compare(version, upper) < 0;
  }

  return true;
}

function satisfies(version, semverRange) {
  return String(semverRange)
    .split('||')
    .some((part) => part.trim().split(/\s+/).every((token) => satisfiesComparator(version, token)));
}

if (!range) {
  console.log(JSON.stringify({
    ok: true,
    warning: 'package.json does not declare engines.node',
    currentNode: current,
  }, null, 2));
  process.exit(0);
}

const ok = satisfies(current, range);
console.log(JSON.stringify({
  ok,
  currentNode: current,
  expectedNode: range,
  packageName: pkg.name ?? null,
}, null, 2));

process.exit(ok ? 0 : 1);
