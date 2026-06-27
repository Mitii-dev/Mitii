#!/usr/bin/env node
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const json = args.includes('--json');
const limitIndex = args.findIndex((arg) => arg === '--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1] ?? 5) : 5;
const catalogIndex = args.findIndex((arg) => arg === '--catalog');
const catalogPath = catalogIndex >= 0
  ? resolve(process.cwd(), args[catalogIndex + 1])
  : resolve(here, 'script-catalog.json');

const query = args
  .filter((arg, index) => {
    if (arg === '--json' || arg === '--limit' || arg === '--catalog') return false;
    if (limitIndex >= 0 && index === limitIndex + 1) return false;
    if (catalogIndex >= 0 && index === catalogIndex + 1) return false;
    return true;
  })
  .join(' ')
  .trim();

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/)
    .filter(Boolean);
}

function entryText(entry) {
  return [
    entry.name,
    entry.category,
    entry.command,
    entry.description,
    ...(entry.keywords ?? []),
  ].join(' ');
}

function scoreEntry(entry, terms) {
  const haystack = entryText(entry).toLowerCase();
  const words = new Set(tokenize(haystack));
  let score = 0;

  for (const term of terms) {
    if (words.has(term)) score += 6;
    if (haystack.includes(term)) score += 3;
    for (const keyword of entry.keywords ?? []) {
      const keywordText = keyword.toLowerCase();
      if (keywordText === term) score += 8;
      else if (keywordText.includes(term)) score += 4;
    }
  }

  if (haystack.includes(query.toLowerCase())) score += 10;
  return score;
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const terms = tokenize(query);
const matches = catalog
  .map((entry) => ({ ...entry, score: terms.length ? scoreEntry(entry, terms) : 1 }))
  .filter((entry) => entry.score > 0)
  .sort((a, b) => b.score - a.score || a.id - b.id)
  .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 5)
  .map(({ score, ...entry }) => ({ ...entry, score }));

if (json) {
  console.log(JSON.stringify({ query, matches }, null, 2));
} else if (!matches.length) {
  console.log(`No scripts matched "${query}".`);
} else {
  for (const match of matches) {
    console.log(`${match.name} (${match.category})`);
    console.log(`  command: ${match.command}`);
    console.log(`  why: ${match.description}`);
    console.log(`  readOnly: ${match.readOnly}`);
  }
}
