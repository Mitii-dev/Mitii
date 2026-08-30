import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Top-level benchmark domains (not global easy/medium/hard). */
export const DOMAINS = Object.freeze(['frontend', 'backend', 'cicd', 'testing']);
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);
export const MODES = Object.freeze(['ask', 'plan', 'agent']);
export const DEFAULT_CASE_FILES = Object.freeze(['easy.jsonl', 'medium.jsonl', 'hard.jsonl']);

export function listSuites(rootDir) {
  const suitesDir = join(rootDir, 'suites');
  if (!existsSync(suitesDir)) return [];
  return readdirSync(suitesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(suitesDir, name, 'suite.json')))
    .sort((a, b) => domainSortKey(a) - domainSortKey(b) || a.localeCompare(b));
}

export function loadSuiteManifest(rootDir, suiteId) {
  const path = join(rootDir, 'suites', suiteId, 'suite.json');
  if (!existsSync(path)) throw new Error(`Missing suite manifest: ${path}`);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (!manifest.id) manifest.id = suiteId;
  if (!manifest.caseFiles) manifest.caseFiles = [...DEFAULT_CASE_FILES];
  return manifest;
}

export function loadCases(rootDir, options = {}) {
  const suiteIds = resolveSuiteIds(rootDir, options.suite);
  const cases = [];
  for (const suiteId of suiteIds) {
    const manifest = loadSuiteManifest(rootDir, suiteId);
    for (const fileName of manifest.caseFiles) {
      const path = join(rootDir, 'suites', suiteId, 'cases', fileName);
      if (!existsSync(path)) {
        // Allow empty difficulty files to exist as zero-byte placeholders.
        if (DEFAULT_CASE_FILES.includes(fileName)) continue;
        throw new Error(`Missing case file: ${path}`);
      }
      const difficultyFromFile = fileName.replace(/\.jsonl$/, '');
      const lines = readFileSync(path, 'utf8').split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          const difficulty = parsed.difficulty ?? (
            DIFFICULTIES.includes(difficultyFromFile) ? difficultyFromFile : undefined
          );
          cases.push({
            ...parsed,
            suite: parsed.suite ?? suiteId,
            difficulty,
            category: parsed.category ?? null,
            sourceFile: fileName,
          });
        } catch (error) {
          throw new Error(`${path}:${index + 1}: invalid JSON (${error.message})`);
        }
      }
    }
  }
  return cases;
}

export function filterCases(cases, filters = {}) {
  return cases.filter((testCase) => {
    if (filters.suite && testCase.suite !== filters.suite) return false;
    if (filters.difficulty && testCase.difficulty !== filters.difficulty) return false;
    if (filters.mode && testCase.mode !== filters.mode) return false;
    if (filters.fixture && testCase.fixture !== filters.fixture) return false;
    if (filters.category && testCase.category !== filters.category) return false;
    if (filters.id && !testCase.id.includes(filters.id)) return false;
    return true;
  });
}

function resolveSuiteIds(rootDir, suiteFilter) {
  const available = listSuites(rootDir);
  if (!available.length) throw new Error('No suites found under suites/');
  if (!suiteFilter || suiteFilter === 'all') return available;
  if (!available.includes(suiteFilter)) {
    throw new Error(`Unknown suite "${suiteFilter}". Available: ${available.join(', ')}`);
  }
  return [suiteFilter];
}

function domainSortKey(name) {
  const index = DOMAINS.indexOf(name);
  return index === -1 ? 100 : index;
}
