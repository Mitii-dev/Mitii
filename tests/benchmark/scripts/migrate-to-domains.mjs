#!/usr/bin/env node
/**
 * One-shot migrator: core + flat frontend → domain suites
 *   suites/{frontend,backend,cicd,testing}/cases/{easy,medium,hard}.jsonl
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from '../src/cases.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOMAINS = ['frontend', 'backend', 'cicd', 'testing'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

function domainFor(c) {
  const text = `${c.id} ${c.familyId} ${c.capability} ${c.prompt} ${c.fixture} ${c.category || ''}`.toLowerCase();

  if (c.category === 'testing-quality' || c.id.includes('vitest-rtl') || c.id.includes('coverage-reporting')) {
    return 'testing';
  }
  if (c.id.includes('github-actions') || c.category === 'cicd') return 'cicd';

  if (
    c.suite === 'frontend' ||
    c.fixture === 'frontend-app' ||
    c.fixture === 'react-vite' ||
    c.fixture === 'next-app'
  ) {
    return 'frontend';
  }

  if (c.capability === 'testing' || c.capability === 'regression') return 'testing';

  if (/ci\/cd|github actions|\.github\/workflows|pipeline|deploy|dockerfile|kubernetes|helm/.test(text)) {
    return 'cicd';
  }

  if (c.capability === 'tooling' && /ci|workflow|deploy|pipeline/.test(text)) return 'cicd';
  if (c.capability === 'tooling' && /test|coverage|jest|vitest/.test(text)) return 'testing';

  return 'backend';
}

/** Rebalance dedicated FE generator cases into clearer difficulties. */
function difficultyFor(c, domain) {
  if (c.suite === 'frontend' || c.fixture === 'frontend-app') {
    const n = Number(String(c.id).match(/fe-(\d+)/)?.[1] || 0);
    if (!n) return c.difficulty;
    // 1-20 setup/auth → easy/medium, 21-60 components/forms → medium, 61-100 perf/a11y/test → hard-ish
    if (n <= 10) return 'easy';
    if (n <= 40) return 'medium';
    if (n <= 70) return 'medium';
    return 'hard';
  }
  if (DIFFICULTIES.includes(c.difficulty)) return c.difficulty;
  return 'medium';
}

function suiteMeta(domain, counts) {
  const names = {
    frontend: 'Frontend Agent Benchmark',
    backend: 'Backend Agent Benchmark',
    cicd: 'CI/CD Agent Benchmark',
    testing: 'Testing Agent Benchmark',
  };
  const descriptions = {
    frontend: 'UI, React/Next, styling, a11y, responsive, and client-side feature work.',
    backend: 'APIs, services, bugfixes, retrieval, planning, and server-side coding tasks.',
    cicd: 'Pipelines, workflows, deploy configs, and automation scripting.',
    testing: 'Unit/integration/e2e tests, coverage, and regression verification.',
  };
  return {
    id: domain,
    name: names[domain],
    description: descriptions[domain],
    caseFiles: ['easy.jsonl', 'medium.jsonl', 'hard.jsonl'],
    expectedCounts: {
      easy: counts.easy,
      medium: counts.medium,
      hard: counts.hard,
      total: counts.easy + counts.medium + counts.hard,
    },
    gates: {
      easy: 0.9,
      medium: 0.8,
      hard: 0.7,
      overall: 0.8,
    },
  };
}

const all = loadCases(rootDir, { suite: 'all' });
const buckets = Object.fromEntries(
  DOMAINS.map((domain) => [
    domain,
    Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, []])),
  ])
);

for (const raw of all) {
  const domain = domainFor(raw);
  const difficulty = difficultyFor(raw, domain);
  const next = {
    ...raw,
    suite: domain,
    difficulty,
  };
  // Drop loader-only nulls pollution
  if (next.category == null) delete next.category;
  buckets[domain][difficulty].push(next);
}

// Wipe old suite dirs and rewrite
const suitesRoot = join(rootDir, 'suites');
if (existsSync(suitesRoot)) rmSync(suitesRoot, { recursive: true, force: true });

for (const domain of DOMAINS) {
  const counts = {
    easy: buckets[domain].easy.length,
    medium: buckets[domain].medium.length,
    hard: buckets[domain].hard.length,
  };
  const suiteDir = join(suitesRoot, domain);
  const casesDir = join(suiteDir, 'cases');
  mkdirSync(casesDir, { recursive: true });
  writeFileSync(join(suiteDir, 'suite.json'), `${JSON.stringify(suiteMeta(domain, counts), null, 2)}\n`);
  for (const difficulty of DIFFICULTIES) {
    const rows = buckets[domain][difficulty];
    const path = join(casesDir, `${difficulty}.jsonl`);
    writeFileSync(path, rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '');
    console.log(`${domain}/${difficulty}: ${rows.length}`);
  }
  console.log(`${domain} total: ${counts.easy + counts.medium + counts.hard}`);
}

console.log('Migration complete.');
